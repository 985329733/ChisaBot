# ChisaBot PC 节点（服务器端 + Windows 客户端）

> 2026-10-10，image `local/chisabot:glass-20261010m`，客户端 `chisabot-pc` 0.1.0。
> 目标：服务器、PC、手机任何一端都能管理其他端；PC 既是远程聊天客户端，也是让服务器上的机器人在授权范围内操作这台电脑的「节点」（参考 OpenClaw 的 node：节点出站连接网关、声明命令面、危险命令需显式开启与审批）。

## 1. 角色

| 端 | 是什么 | 能做什么 |
| --- | --- | --- |
| **服务器** | 现有 ChisaBot（`openbot-zh` 容器，公网 `https://ayase.cn:8443`，前面是 nginx 登录网关） | 机器人运行处；设备登记表、WebSocket 中转、审批、审计都在这里 |
| **PC（Windows）** | `ChisaBot PC` Electron 客户端 | ① 聊天窗口直接载入该服务器的网页；② 节点：执行机器人发来的操作（PowerShell、文件、截图、鼠标键盘、打开应用/网址、剪贴板） |
| **手机** | 现有网页（已适配 390px） | 聊天；在 设置 → 设备 管理所有 PC：开关能力、审批、紧急停止、撤销、看记录 |

「从任何一端管理其他端」：设备配置只存服务器一份。网页/手机改 → 服务器写库 → 推送给 PC；PC 改 → 发 `set_config` → 服务器写库 → 网页 5 秒内刷新。PC 客户端里的聊天窗口就是网页本身，所以在 PC 上也能管理其他 PC 和服务器（管理后台）。

## 2. 连接方式（传输）

- **PC 只做出站连接**：`wss://<服务器>/api/devices/agent/ws`，走现有 HTTPS 443/8443，不需要在 PC 上开任何入站端口，也能穿过 NAT。
- 握手头：`X-Device-Token: cbd_…`（设备令牌）、`Origin: <服务器 origin>`（网关拒绝没有 Origin 的 WebSocket）。
- 断线自动重连：1s → 2s → … 封顶 30s，带 ±30% 抖动；服务器每 25s 发 `ping`，PC 回 `pong`。
- 同一设备重复连接时，旧连接被替换（关闭码 4000）。撤销时服务器发 `{"type":"revoked"}` 并以 4401 关闭，PC 停止重连。
- 网关：`/api/devices/agent/` 前缀在 nginx 里**不做会话校验**（PC 没有网关 Cookie），只靠设备令牌；其它 `/api/devices/*` 仍在网关登录之后。令牌失败按 IP 限速（10 分钟 20 次）。

### 2.1 协议（JSON 文本帧，类型见 `shared/devices.ts`）

服务器 → PC：`welcome{device}`、`config{device}`、`approval_request{id,operation,summary,botName,expiresAt}`、`approval_closed{id,decision}`、`call{id,operation,args,botName,timeoutMs}`、`cancel{id}`、`revoked`、`ping`。

PC → 服务器：`hello{clientVersion,platform,osVersion,hostname,arch}`、`result{id,ok,result|error}`、`approval{id,decision}`、`set_config{name?,capabilities?,allowedRoots?,paused?}`、`local_audit{…}`、`pong`。

## 3. 登录与配对

1. PC 首次运行出现设置向导：**服务器地址**（默认 `https://ayase.cn:8443`）+ **账号密码** + 电脑名称。
2. 客户端先 `POST /auth/login`（网关登录，`remember: true`）；该部署没有网关时退回 Better Auth `POST /api/auth/sign-in/email`。得到会话 Cookie。
3. 用会话 Cookie 调 `POST /api/devices/enroll` → 服务器生成设备 `dev_…` 和令牌 `cbd_<32 字节 base64url>`，**令牌只返回这一次**，库里只存 SHA-256。
4. 令牌在 PC 上用 Electron `safeStorage`（Windows DPAPI，绑定当前 Windows 用户）加密保存；会话 Cookie 注入聊天窗口的独立分区，聊天窗口因此免登录。
5. 密码不落盘。之后节点连接只用设备令牌；网关会话过期只影响聊天窗口（会跳到登录页），不影响节点。
6. 换服务器 / 退出登录：PC 调 `POST /api/devices/agent/unenroll` 作废自己的令牌，清除 Cookie，回到设置向导。

## 4. 设备登记表（迁移 `0054_pc_devices`）

- `devices`：id、owner_user_id、name、platform、os_version、hostname、arch、client_version、token_hash、capabilities(jsonb)、allowed_roots(jsonb)、paused、revoked_at、last_seen_at、last_ip、created_at。
- `device_bot_access`：(device_id, bot_id)。没有行 = 该机器人看不到这台电脑。
- `device_audit_events`：每个远程操作、每次配置改动、登记/撤销/紧急停止。机器人调用**先写一行 `requested`，结束后改成最终结果**（成功 / 失败 / 已拒绝 / 用户拒绝 / 审批超时 / 离线 / 超时）+ 耗时，进程崩溃也留下痕迹。登记、修改、撤销、删除另记一条到系统审计（`configuration.changed`，targetType `device`），管理后台 → 审计 可见。

## 5. 能力模型

| 能力 | 操作 | 默认 | 风险 |
| --- | --- | --- | --- |
| （始终可用） | `system_info` 系统版本、主机名、CPU、内存、屏幕 | — | 低 |
| `shell` 命令行 | PowerShell（`-EncodedCommand`，UTF-8 输出），超时默认 60s 最长 600s，stdout/stderr 各 64KB 上限，超时杀进程树 | 关闭 | 高 |
| `files_read` 读取文件 | 列目录（≤500 项）、读文件（默认 256KB，最多 1MB，二进制返回 base64） | 关闭 | 中 |
| `files_write` 写入文件 | 覆盖前备份为 `*.chisabot-bak`，可追加 | 关闭 | 高 |
| `screenshot` 截图 | Electron `desktopCapturer` 主屏，物理分辨率截取后缩放到 ≤1600 宽；无 Electron 时 PowerShell `CopyFromScreen` 兜底 | 关闭 | 中 |
| `input` 鼠标键盘 | `SetCursorPos` / `mouse_event`（DPI aware，物理像素坐标）、`SendKeys` 输入文字和按键 | 关闭 | 高 |
| `open` 打开应用 / 网址 | http/https 用默认浏览器；其它用 `Start-Process`；拒绝 `javascript:` `file:` `data:` | 关闭 | 中 |
| `clipboard` 剪贴板 | 读 / 写文字 | 关闭 | 中 |

每项三态：**关闭 / 询问（每次审批）/ 允许（直接执行，仍审计）**。文件类能力还受**允许的文件夹**约束：相对路径相对第一个文件夹；解析符号链接后比较前缀（Windows 不区分大小写），防止 `..` 和链接逃逸；没有文件夹时一律拒绝。

机器人工具（`server/src/devices/tools.ts`）：`device_list`、`device_system_info`、`device_run_shell`、`device_list_files`、`device_read_file`、`device_write_file`、`device_screenshot`、`device_input`、`device_open`、`device_clipboard`。只给「这个机器人被勾选、且属于这次运行的人」的设备；某能力在所有设备上都关闭时对应工具不出现。每个工具的说明里带当前可用设备列表（id、名称、在线、已开能力），机器人每次调用都要指定 `deviceId`。截图原图留在服务器内存 30 分钟，工具返回 `/api/devices/<id>/screenshots/<sid>`，机器人可以在回复里用 Markdown 展示。

## 6. 安全

三道闸，任何一道说不就不执行：

1. **服务器**（`hub.invoke`）：已撤销 → 拒绝；紧急停止 → 拒绝；能力关闭 → 拒绝；离线 → 拒绝；「询问」→ 先建审批（PC 弹窗 + 网页/手机「等待你审批」卡片，谁先点算谁，2 分钟无人处理按拒绝），批准后再读一次最新配置。
2. **PC 本机**（`agent/core.js`）：本机紧急停止、本机那份能力开关（从服务器同步）再检查一次；**「高风险操作始终在本机确认」默认开启**——命令行、写入文件、鼠标键盘即使服务器设为「允许」也在 PC 上弹窗确认（服务器被攻破也不能静默操作这台电脑）。
3. **路径 / 进程约束**：允许的文件夹、输出上限、超时、取消即杀进程树。

紧急停止（kill switch）：PC 托盘菜单「紧急停止」、PC 设置页、网页设备详情都能按；立即取消进行中的调用和审批，之后一切远程操作被拒绝，直到在任一端解除。撤销：令牌作废并断开，PC 必须重新登录。

审计：服务器 `device_audit_events`（网页「操作记录」）+ PC 本机 `audit.jsonl`（PC 设置页「本机记录」，最多 2000 条）。

## 7. 网页（设计见 DESIGN.md §16）

- **偏好设置 → 设备**（`/settings/devices`，模板 B）：待审批卡片 → 我的电脑列表（在线点、系统、最后在线、已开能力数）→ 已撤销 → 添加一台电脑（下载卡片 + 三步说明 + 一键复制服务器地址）。
- **设备详情**（`/settings/devices/$deviceId`，模板 C）：72px 设备图标页头 + 徽标 + 「测试连接」「紧急停止 / 解除」；标签 权限（能力三态分段、允许的文件夹、可用机器人、名称，改动后出现未保存栏）/ 操作记录 / 设备（ID、登记时间、危险区：撤销、删除）。
- **管理后台 → 设备（PC）**（`/admin/devices`，模板 E）：统计磁贴（设备 / 在线 / 待审批 / 紧急停止中）+ 全部设备（含所有者）。
- 下载：网关托管 `https://ayase.cn:8443/downloads/pc/`（需登录），清单 `latest.json`，设备页自动显示版本、大小、SHA-256。

## 8. Windows 客户端（`/workspace/work/chisabot-pc`）

- 技术栈：Electron 44 + `ws`；无原生模块（输入/截图兜底都走 PowerShell），所以能在 Linux 上交叉打包。安装包用 electron-builder（NSIS，中文界面，可选安装目录，桌面 / 开始菜单快捷方式）+ 免安装 zip。
- 窗口：设置向导、聊天（载入服务器网页，关闭即缩到托盘）、设置与权限（能力三态、允许的文件夹（系统文件夹选择器）、紧急停止、本机记录、开机自启、高风险本机确认、改名、退出登录 / 换服务器）、审批弹窗（右下角置顶，倒计时，Esc = 拒绝）。
- 托盘：蓝（在线）/ 灰（离线，自动重连中）/ 红（紧急停止）；菜单：状态、打开聊天、设置与权限、紧急停止 / 解除、退出。
- 开机自启：`app.setLoginItemSettings({ openAtLogin, args: ["--hidden"] })`，静默进托盘并连接。
- 无界面节点：`node src/cli.js login|run|logout --server … --token-file …`，用于测试或在没有桌面的机器上跑。

## 9. 已知限制 / 下一步

- 截图只截主屏；多屏、录屏、摄像头未做。浏览器自动化（CDP 控制本机 Chrome）未做——服务器端机器人已有自己的「计算机」浏览器。
- 机器人目前拿到的是截图地址，模型本身看不到图片内容（需要把截图作为图像内容块注入模型上下文，属于运行时改造）。
- 安装包未签名（Windows SmartScreen 会提示「未知发布者」）；无自动更新。
- 网页的审批是轮询（5 秒），不是推送；审批也还没并入 `/approvals` 审批页。
- `drizzle/meta` 没有 0054 的快照：下次用 `drizzle-kit generate` 前先补一份快照，否则会重复生成这三张表。
- 网关之外的部署（Better Auth 多用户）登录路径已实现但没有实际测过。
