# Backlog（议题清单）

> **为什么是文件**：仓库的 GitHub Issues 目前是关闭的（fork 默认关闭，自动化令牌没有仓库管理权限，开不了）。在仓库所有者打开
> Settings → General → Features → Issues 之前，这里就是 issue 列表；打开之后每一条按 ID 原样建成 GitHub issue，标签、里程碑、
> 验收标准一致，这个文件改成索引（ID → issue 编号）。标签和里程碑已经在 GitHub 上建好。

规则：

- 一条 = 一个可验收的结果。新需求先在这里加一条（下一个 ID），再开分支；PR 描述写 `Backlog: CB-0xx`。
- 状态写在标签行：`status: in-progress`（有人在做）、`blocked`（写明卡在哪）、`needs-user`（要用户操作 / 决定）、`deferred`（以后再做）。
- 做完：勾掉验收标准，整条移到文末「已完成」，写 PR 号和合并提交。
- 优先级：P0 立刻 / P1 这一轮 / P2 排队。里程碑见 [ROADMAP](ROADMAP.md)。

| ID | 标题 | 里程碑 | 标签 |
|---|---|---|---|
| [CB-001](#cb-001) | 审批卡片与审批偏好（Hark parity 第 5 项） | Hark parity | `type: feat` · `area: approvals` · `area: chat` · `P1` · `status: in-progress` |
| [CB-002](#cb-002) | 生图 / 识图模型设置：管理员默认 + 每人可覆盖 | Hark parity | `type: feat` · `area: images` · `area: settings` · `P1` · `status: in-progress` |
| [CB-003](#cb-003) | 成熟度扫查：设备流程优先的全量体验检查 | 成熟度 Maturity | `type: chore` · `area: devices` · `area: chat` · `P1` · `status: in-progress` |
| [CB-004](#cb-004) | 设备上的编码工具：云端机器人读 / 改 / 写本地代码 | 设备核心 Devices core | `type: feat` · `area: devices` · `area: pc` · `P0` · `status: in-progress` |
| [CB-005](#cb-005) | 无界面设备节点：Linux / macOS 服务器也能当设备 | 设备核心 Devices core | `type: feat` · `area: devices` · `area: infra` · `P1` · `status: in-progress` |
| [CB-006](#cb-006) | 设备「完全访问」模式（像本地 OpenClaw / Hermes） | 设备核心 Devices core | `type: feat` · `area: devices` · `area: approvals` · `P1` · `status: in-progress` |
| [CB-007](#cb-007) | 本地 agent 运行时与 agent 选择（可选） | 设备核心 Devices core | `type: feat` · `area: agents` · `area: devices` · `P1` · `status: in-progress` |
| [CB-008](#cb-008) | 本地 agent 的沙箱 / 权限配置档 | 设备核心 Devices core | `type: feat` · `area: agents` · `area: approvals` · `P1` · `status: in-progress` |
| [CB-009](#cb-009) | 瘦身 P3：删不发布的目录 + 修 server-typecheck CI | 精简 Slim | `type: chore` · `area: slim` · `area: infra` · `P1` · `status: in-progress` |
| [CB-010](#cb-010) | 瘦身 P4a：删前端死页 | 精简 Slim | `type: chore` · `area: slim` · `area: settings` · `P1` · `status: done` |
| [CB-011](#cb-011) | 瘦身 P4b：不再构造上游服务端模块（表保留） | 精简 Slim | `type: chore` · `area: slim` · `area: infra` · `P1` · `status: in-progress` |
| [CB-012](#cb-012) | 项目维护与文档系统（labels / milestones / ROADMAP / ADR / 模板） | 成熟度 Maturity | `type: docs` · `area: docs` · `P1` · `status: in-progress` |
| [CB-013](#cb-013) | Google 账号连接（Hark parity 最后一项） | Hark parity | `type: feat` · `area: settings` · `P2` · `status: deferred` |
| [CB-014](#cb-014) | 每日简报（Hark parity 第 9 项，可选） | Hark parity | `type: feat` · `area: schedules` · `P2` · `status: deferred` |
| [CB-015](#cb-015) | 瘦身 P4c：合并重复系统（依赖并行功能） | 精简 Slim | `type: chore` · `area: slim` · `P2` · `status: blocked` |
| [CB-016](#cb-016) | 瘦身 P5：DROP 上游空表（P4 稳定 ≥ 2 周后） | 精简 Slim | `type: chore` · `area: slim` · `area: infra` · `P2` · `status: blocked` |
| [CB-017](#cb-017) | 真机验证：Windows PC 客户端与安卓手机 | 0.2.0 release | `type: chore` · `area: pc` · `area: android` · `P1` · `status: needs-user` |
| [CB-018](#cb-018) | 用户的电脑需要手动重装 PC 0.1.7（0.2.x 不会自动更新） | 0.2.0 release | `type: chore` · `area: pc` · `P1` · `status: needs-user` |
| [CB-019](#cb-019) | 发版 0.2.0（PC + Android） | 0.2.0 release | `type: chore` · `area: infra` · `area: pc` · `area: android` · `P1` |
| [CB-020](#cb-020) | CI「ChisaBot checks」server-typecheck 在 main 上一直失败 | 精简 Slim | `type: bug` · `area: infra` · `P1` |
| [CB-021](#cb-021) | 一轮里两次 page_update 会出两张同一页面的卡片 | 成熟度 Maturity | `type: bug` · `area: pages` · `area: chat` · `P2` |
| [CB-022](#cb-022) | 只读工具的结果没有卡片（只有文字） | 成熟度 Maturity | `type: feat` · `area: chat` · `P2` |
| [CB-023](#cb-023) | 后台任务卡片在参数流完前显示笼统的「正在交给后台…」 | 成熟度 Maturity | `type: bug` · `area: chat` · `P2` |
| [CB-024](#cb-024) | 切换暗色外观卡约 400ms | 成熟度 Maturity | `type: perf` · `area: chat` · `area: settings` · `P2` |
| [CB-025](#cb-025) | 打开长对话首屏渲染约 1 秒 | 成熟度 Maturity | `type: perf` · `area: chat` · `P2` |
| [CB-026](#cb-026) | chisabot_bot_threads：确认没有孤儿指针行 | 成熟度 Maturity | `type: chore` · `area: chat` · `P2` |
| [CB-027](#cb-027) | IM 定时推送受平台被动回复窗口限制 | 成熟度 Maturity | `type: bug` · `area: im` · `area: schedules` · `P2` |
| [CB-028](#cb-028) | 「开场一句」只在显示时折叠，事件历史里仍保存 | 成熟度 Maturity | `type: chore` · `area: chat` · `P2` |
| [CB-029](#cb-029) | 弹窗打开动画仍有毛玻璃开销 | 成熟度 Maturity | `type: perf` · `area: settings` · `P2` |
| [CB-030](#cb-030) | 设备能力「打开」实际可执行任意命令，却标为非危险 | 设备核心 Devices core | `type: bug` · `area: devices` · `area: pc` · `P1` |
| [CB-031](#cb-031) | 本地对话事件表无上限增长 | 成熟度 Maturity | `type: chore` · `area: chat` · `area: infra` · `P2` |
| [CB-032](#cb-032) | 安卓签名改为 CI 内签名（需要仓库 Actions secrets） | 0.2.0 release | `type: chore` · `area: android` · `area: infra` · `P2` · `status: needs-user` |
| [CB-033](#cb-033) | 生产跨部署 stale-chunk 测试待跑 | 成熟度 Maturity | `type: chore` · `area: infra` · `P2` |
| [CB-034](#cb-034) | 用真实账号验证 GitHub 连接与 IM 接入 | 成熟度 Maturity | `type: chore` · `area: github` · `area: im` · `P2` · `status: needs-user` |

## CB-001

**审批卡片与审批偏好（Hark parity 第 5 项）**  
里程碑：Hark parity · 标签：`type: feat` `area: approvals` `area: chat` `P1` `status: in-progress`

#### 背景

机器人做需要确认的事（花钱、发消息、写操作、设备上的危险能力）时，在聊天里出审批卡片；用户可以设「这类事不用问我 / 一律先问我」的偏好，机器人照着做。上游 server/src/approvals/（policy.ts allow/pre_approved/ask/hand_off）是起点。

#### 验收标准

- [ ] 聊天里出审批卡片：允许 / 拒绝，服务器原子地 pending→running，第二台设备 / 第二次点击不会重复执行
- [ ] 设置里能看到、改、删审批偏好；机器人每轮读到偏好并遵守
- [ ] 设备「询问」能力、GitHub 写操作沿用同一套卡片（或明确说明为什么不合并）
- [ ] 单测 + 预览 e2e + 生产一次性机器人 e2e 通过；聊天滚动回归 7/7
- [ ] DESIGN.md 新章节 + docs/approvals.md + CHANGELOG Unreleased

#### 相关

- 上游：server/src/approvals/、app/src/routes/_authed/_app/approvals.tsx
- 瘦身 P4c ⑤：合并后删团队审批规则、权限规则并入

> 进行中：worker cb-feat-approvals-2，分支 feat/approvals。完成时在 PR 里 `Backlog: CB-001`（issue 开启后改为 `Closes #编号`），同一个 PR 更新 docs/ 与 CHANGELOG.md（见 [CONTRIBUTING.md](../CONTRIBUTING.md)）。

## CB-002

**生图 / 识图模型设置：管理员默认 + 每人可覆盖**  
里程碑：Hark parity · 标签：`type: feat` `area: images` `area: settings` `P1` `status: in-progress`

#### 背景

§56 的生图目前只有管理员一个开关和一套接口（MiniMax image-01）。需要在「模型」设置里分别选生图模型和识图（看图）模型，管理员给默认值，每个用户可以覆盖成自己的。

#### 验收标准

- [ ] 设置里能分别选生图模型、识图模型；管理员设部署默认，用户可覆盖，清空覆盖回到默认
- [ ] image_generate / image_edit 和读图走所选模型；没配置时机器人如实说明去哪里配
- [ ] 密钥不进模型、不进日志（复用 §52 / 模型密钥）
- [ ] 测试 + 生产 e2e；DESIGN.md 章节、docs/chat-files.md 更新、CHANGELOG

#### 相关

- DESIGN.md §56、docs/chat-files.md

> 进行中：worker cb-feat-media，分支 feat/model-media。完成时在 PR 里 `Backlog: CB-002`（issue 开启后改为 `Closes #编号`），同一个 PR 更新 docs/ 与 CHANGELOG.md（见 [CONTRIBUTING.md](../CONTRIBUTING.md)）。

## CB-003

**成熟度扫查：设备流程优先的全量体验检查**  
里程碑：成熟度 Maturity · 标签：`type: chore` `area: devices` `area: chat` `P1` `status: in-progress`

#### 背景

目标是「相对成熟、可以分享给朋友」。按真实用户路径把每个功能走一遍（设备流程优先），把发现的问题逐条记下并修。

#### 验收标准

- [x] 扫查清单覆盖：登录、新建机器人、聊天（流式 / 卡片 / 排队 / 后台任务）、设备关联与权限、记忆、技能、密钥、GitHub、页面、定时、文件与生图、IM、设置导航（2026-10-15 第一轮：设备流程 + 聊天 + 19 页 × 4 视图巡检；结果见 DESIGN.md §60 与 PR 描述）
- [ ] 每个问题变成一个 issue（type: bug，带 area 和优先级），能当场修的随 PR 修掉并关闭
- [ ] 宽 1280 / 窄 420 / 暗色三种截图证据
- [ ] 扫查结果汇总进 ROADMAP「现在」

> 进行中：worker cb-qa，分支 fix/maturity-1。完成时在 PR 里 `Backlog: CB-003`（issue 开启后改为 `Closes #编号`），同一个 PR 更新 docs/ 与 CHANGELOG.md（见 [CONTRIBUTING.md](../CONTRIBUTING.md)）。

## CB-004

**设备上的编码工具：云端机器人读 / 改 / 写本地代码**  
里程碑：设备核心 Devices core · 标签：`type: feat` `area: devices` `area: pc` `P0` `status: in-progress`

#### 背景

用户核心诉求（2026-10-15）：在任何地方管理所有设备，云端机器人能读、改、写本地电脑上的文件和代码。现有 device_* 只有截图、打开、命令、读写文件等粗粒度能力。

#### 验收标准

- [ ] 机器人能在授权文件夹里：列目录、按内容搜索、读文件片段、精确替换编辑、新建文件、跑测试 / 构建命令并看到输出
- [ ] 每个写操作经过设备权限（关闭 / 询问 / 允许）和审计记录；危险命令仍要本机确认
- [ ] 大文件 / 大输出截断并说明；二进制文件拒绝
- [ ] 在 PC 节点和无界面节点上都能用；预览 + 生产 e2e
- [ ] docs/pc-node.md 与 DESIGN.md 更新、CHANGELOG

#### 相关

- DESIGN.md §16、§45；docs/pc-node.md

> 进行中：worker cb-devices，分支 feat/devices-1。完成时在 PR 里 `Backlog: CB-004`（issue 开启后改为 `Closes #编号`），同一个 PR 更新 docs/ 与 CHANGELOG.md（见 [CONTRIBUTING.md](../CONTRIBUTING.md)）。

## CB-005

**无界面设备节点：Linux / macOS 服务器也能当设备**  
里程碑：设备核心 Devices core · 标签：`type: feat` `area: devices` `area: infra` `P1` `status: in-progress`

#### 背景

除了 Windows 上的 ChisaBot PC，用户的 Linux 服务器、Mac 也要能关联成设备，让机器人去操作。

#### 验收标准

- [ ] 一条命令安装 / 关联（令牌一次性），systemd / launchd 常驻，断线重连
- [ ] 出现在 设置 → 设备，能力与权限模型和 PC 一致
- [ ] 不需要图形界面；截图类能力在无显示器时如实报不可用
- [ ] 安装、升级、卸载写进 docs/pc-node.md（或新 docs/node.md）

> 进行中：worker cb-devices。完成时在 PR 里 `Backlog: CB-005`（issue 开启后改为 `Closes #编号`），同一个 PR 更新 docs/ 与 CHANGELOG.md（见 [CONTRIBUTING.md](../CONTRIBUTING.md)）。

## CB-006

**设备「完全访问」模式（像本地 OpenClaw / Hermes）**  
里程碑：设备核心 Devices core · 标签：`type: feat` `area: devices` `area: approvals` `P1` `status: in-progress`

#### 背景

用户希望 PC 能给机器人「完全权限」，同时保留权限控制 / 沙箱：一个明确的模式切换，而不是逐项打开七个能力。

#### 验收标准

- [ ] 设备上有「完全访问」开关，打开前一次清楚的风险确认（本机 + 网页都显示状态）
- [ ] 完全访问下命令 / 文件 / 键鼠不再逐次询问，但全部写审计，有一键急停（kill switch）
- [ ] 随时可以退回「询问」；服务器重启后状态保持
- [ ] ADR 记录这个取舍；DESIGN.md + docs/pc-node.md 更新

> 进行中：worker cb-devices。完成时在 PR 里 `Backlog: CB-006`（issue 开启后改为 `Closes #编号`），同一个 PR 更新 docs/ 与 CHANGELOG.md（见 [CONTRIBUTING.md](../CONTRIBUTING.md)）。

## CB-007

**本地 agent 运行时与 agent 选择（可选）**  
里程碑：设备核心 Devices core · 标签：`type: feat` `area: agents` `area: devices` `P1` `status: in-progress`

#### 背景

默认仍是「云端 agent + 设备节点」（见 ADR-0003）。用户说「做」：允许在设备上跑本地 agent 运行时（如 Claude Code / Codex 一类 CLI agent），并在机器人上选择由哪个 agent 回答。

#### 验收标准

- [ ] 设备上能登记可用的本地 agent 运行时；机器人资料页能选「云端（默认）/ 某台设备上的某个 agent」
- [ ] 本地 agent 的输出以同样的聊天流式、卡片、停止语义呈现
- [ ] 设备离线时如实提示，不静默失败
- [ ] 文档：架构图更新、docs/ 新页面、ADR 补充

> 进行中：worker cb-localagent，分支 feat/local-agent-1。完成时在 PR 里 `Backlog: CB-007`（issue 开启后改为 `Closes #编号`），同一个 PR 更新 docs/ 与 CHANGELOG.md（见 [CONTRIBUTING.md](../CONTRIBUTING.md)）。

## CB-008

**本地 agent 的沙箱 / 权限配置档**  
里程碑：设备核心 Devices core · 标签：`type: feat` `area: agents` `area: approvals` `P1` `status: in-progress`

#### 背景

本地 agent 运行时需要成套的权限配置档（只读 / 工作区可写 / 完全访问 等），和设备能力、审批偏好一致。

#### 验收标准

- [ ] 至少三档配置，界面上一句话说清每档能做什么
- [ ] 配置档在服务器强制执行并写审计（不只靠本地 agent 自觉）
- [ ] 和「完全访问」模式、审批偏好不冲突，文档写明优先级

> 进行中：worker cb-localagent。完成时在 PR 里 `Backlog: CB-008`（issue 开启后改为 `Closes #编号`），同一个 PR 更新 docs/ 与 CHANGELOG.md（见 [CONTRIBUTING.md](../CONTRIBUTING.md)）。

## CB-009

**瘦身 P3：删不发布的目录 + 修 server-typecheck CI**  
里程碑：精简 Slim · 标签：`type: chore` `area: slim` `area: infra` `P1` `status: in-progress`

#### 背景

删 desktop/（Tauri）、mobile/（Expo）、14 个 agent-*、charts/、spire/、supervisor/、worker/、多余 examples 与对应 CI / renovate 配置。worker/ 在 workspaces 与 Dockerfile 里，删了会改依赖指纹 → 一次完整更新。

#### 验收标准

- [ ] 上述目录删除，examples/fintech 测试夹具替换或保留并说明
- [ ] 根 package.json workspaces、Dockerfile、bun.lock、deps 指纹同步修改；一键完整更新在预览上成功
- [ ] CI「ChisaBot checks」server-typecheck 变绿（关联 issue 一起关掉）
- [ ] docs/slimming.md 记 P3 结果；CHANGELOG

#### 相关

- 审查报告 §5；docs/slimming.md

> 进行中：worker cb-slim-2 / cb-slim-backend。完成时在 PR 里 `Backlog: CB-009`（issue 开启后改为 `Closes #编号`），同一个 PR 更新 docs/ 与 CHANGELOG.md（见 [CONTRIBUTING.md](../CONTRIBUTING.md)）。

## CB-010

**瘦身 P4a：删前端死页**  
里程碑：精简 Slim · 标签：`type: chore` `area: slim` `area: settings` `P1` `status: done`

#### 背景

P1 已把这些页面隐藏 / 重定向：/agents、/team-bots、/group/*、/reachability、/memory（旧）、/admin/{people,enterprise,identity-providers,learning,playground}、/settings/components-gallery、/settings/passwords。删掉它们和只被它们用的 components/、lib/。

#### 验收标准

- [x] 页面与独占组件删除，旧地址仍重定向
- [x] app tsc / build / DOM 测试全过；初始 JS 不变大
- [x] docs/slimming.md、CHANGELOG

> 完成：PR feat/slim-p4a（见 docs/slimming.md「P4a」）。

## CB-011

**瘦身 P4b：不再构造上游服务端模块（表保留）**  
里程碑：精简 Slim · 标签：`type: chore` `area: slim` `area: infra` `P1` `status: in-progress`

#### 背景

移除并不再在 index.ts 构造：team-bots、群聊与 coordination/hand_off、delivery（Slack/Teams/Twilio/push）、proactive、上游 personal memory、learning、routing、demonstrations、SCIM/SSO/身份提供者、企业 gate（先把 model_connection 读写改为独立 KV）、supervisor 客户端；语音改为功能开关默认关。

#### 验收标准

- [ ] 上述模块不再加载，表与数据不动（回滚镜像即可恢复）
- [ ] server 测试、tsc、预览 e2e、生产自检通过
- [ ] docs/slimming.md 记录每个模块的处理与依赖

> 进行中：worker cb-slim-backend。完成时在 PR 里 `Backlog: CB-011`（issue 开启后改为 `Closes #编号`），同一个 PR 更新 docs/ 与 CHANGELOG.md（见 [CONTRIBUTING.md](../CONTRIBUTING.md)）。

## CB-012

**项目维护与文档系统（labels / milestones / ROADMAP / ADR / 模板）**  
里程碑：成熟度 Maturity · 标签：`type: docs` `area: docs` `P1` `status: in-progress`

#### 背景

用户 2026-10-15：「我们最近需求比较多比较杂，你要建立良好的项目维护系统和文档系统。」

#### 验收标准

- [ ] 标签、里程碑、在做 / 推迟 / 已知问题都有 issue，带验收标准
- [ ] docs/README.md 索引、docs/ROADMAP.md、docs/architecture.md、docs/ops/deploy.md、docs/adr/、docs/dev/parallel-work.md
- [ ] CONTRIBUTING.md、PR 模板、issue 模板（bug / feature）
- [ ] DESIGN.md 顶部章节索引；CHANGELOG Unreleased 补齐 §49–§57

> 进行中：分支 chore/pm-system。完成时在 PR 里 `Backlog: CB-012`（issue 开启后改为 `Closes #编号`），同一个 PR 更新 docs/ 与 CHANGELOG.md（见 [CONTRIBUTING.md](../CONTRIBUTING.md)）。

## CB-013

**Google 账号连接（Hark parity 最后一项）**  
里程碑：Hark parity · 标签：`type: feat` `area: settings` `P2` `status: deferred`

#### 背景

用户 2026-10-14 20:01：「Google账号不急」——放在 Hark parity 最后做。需要管理员在 Google Cloud 注册 OAuth 客户端。

#### 验收标准

- [ ] 设置 → 账号连接 里能连 Google（Gmail / 日历 / Drive 只读起步），令牌存保险箱
- [ ] 写操作（发邮件、建日程）走审批卡片
- [ ] 没配置 OAuth 客户端的部署里入口如实说明怎么配

## CB-014

**每日简报（Hark parity 第 9 项，可选）**  
里程碑：Hark parity · 标签：`type: feat` `area: schedules` `P2` `status: deferred`

#### 背景

PARALLEL.md 里的可选第 9 项：每天固定时间机器人把天气、日程、待办、关注的信息汇成一条简报。可以建立在 §55 定时任务之上。

#### 验收标准

- [ ] 用户在聊天里说一句就能设、改时间、停
- [ ] 内容来源可配置，空的部分不显示
- [ ] 推送到网页通知 / IM

## CB-015

**瘦身 P4c：合并重复系统（依赖并行功能）**  
里程碑：精简 Slim · 标签：`type: chore` `area: slim` `P2` `status: blocked`

#### 背景

等相关功能合并后再做：① 旧面板（bot_panel_*）→ 实时面板；② components 存储 → render_ui；③ host_* → device_*；④ 删 responsibilities、wake-up 并入定时任务；⑤ 审批合并后删团队审批规则、权限规则并入；⑥「账号与保险箱」合并；⑦ 决定 Composio 去留。

#### 验收标准

- [ ] 每一项一个 PR，只增不删数据
- [ ] 每项合并前确认依赖功能已上线并稳定
- [ ] docs/slimming.md 逐项记录

#### 相关

- 卡在：审批（feat/approvals）、设备（cb-devices）合并

## CB-016

**瘦身 P5：DROP 上游空表（P4 稳定 ≥ 2 周后）**  
里程碑：精简 Slim · 标签：`type: chore` `area: slim` `area: infra` `P2` `status: blocked`

#### 背景

一个迁移 DROP 所有确认 0 行且无代码引用的上游表（约 60 张）。不可逆：旧镜像在 DROP 后不能直接回滚。

#### 验收标准

- [ ] 迁移前启动时断言这些表为 0 行，否则中止
- [ ] 迁移前 pg_dump 全库；回滚脚本先恢复库再换镜像
- [ ] 最早在 P4b 上线后 2 周

#### 相关

- 卡在：P4b 上线时间 + 2 周

## CB-017

**真机验证：Windows PC 客户端与安卓手机**  
里程碑：0.2.0 release · 标签：`type: chore` `area: pc` `area: android` `P1` `status: needs-user`

#### 背景

0.1.3–0.1.7 的 PC / 安卓改动（图标刷新、小窗、代理、设备默认询问、扫码绑定、PWA 安装、键盘与安全区）都只在模拟环境验证过。

#### 验收标准

- [ ] 真实 Windows：安装、自动更新、图标、小窗、设备连接与权限审批
- [ ] 真实安卓：扫码绑定、撤销后退出、更新
- [ ] iOS Safari 添加到主屏幕、安卓 Chrome 安装 PWA
- [ ] 问题逐条开 issue

## CB-018

**用户的电脑需要手动重装 PC 0.1.7（0.2.x 不会自动更新）**  
里程碑：0.2.0 release · 标签：`type: chore` `area: pc` `P1` `status: needs-user`

#### 背景

版本号归正为 0.1.x 之后，装着内部 0.2.x 构建的电脑永远不会自动更新到 0.1.x；PC 里已有「需要重新安装」提示（§45）。

#### 验收标准

- [ ] 用户卸载旧版、安装 0.1.7（或更新的版本）
- [ ] 设备页显示在线、能力为「询问」，机器人能截图 / 读文件

## CB-019

**发版 0.2.0（PC + Android）**  
里程碑：0.2.0 release · 标签：`type: chore` `area: infra` `area: pc` `area: android` `P1`

#### 背景

汇总 0.1.7 之后合并的服务器 / 网页 / 客户端变化发一次正式版本。

#### 验收标准

- [ ] CHANGELOG Unreleased 整理成 0.2.0
- [ ] 版本号同步（root、pc、android versionName / versionCode 递增）
- [ ] release notes（.github/release-notes/v0.2.0.md / .android.txt）
- [ ] 签名 APK + PC 安装包 + 更新源
- [ ] 真机验证 issue 关闭

#### 相关

- docs/releasing.md、docs/ops/deploy.md

## CB-020

**CI「ChisaBot checks」server-typecheck 在 main 上一直失败**  
里程碑：精简 Slim · 标签：`type: bug` `area: infra` `P1`

#### 背景

至少从 0.1.3 起每个 main 提交都失败（本地镜像里 tsc 是干净的）。原因（run 38592051352）：CI 的干净 bun install（isolated linker）下 shared/ 里的文件解析不到 zod、@json-render/core、@json-render/react/schema（它们在 server/、app/ 的 node_modules），导致 TS2307 和连锁的 TS7006。

#### 验收标准

- [ ] server-typecheck 在 CI 变绿并保持
- [ ] 修复方式写进 docs/development.md
- [ ] 计划随瘦身 P3 一起修

## CB-021

**一轮里两次 page_update 会出两张同一页面的卡片**  
里程碑：成熟度 Maturity · 标签：`type: bug` `area: pages` `area: chat` `P2`

#### 背景

§54 已知问题：机器人在同一轮里对同一个页面调用两次 page_update，聊天里出现两张一样的页面卡片。

#### 验收标准

- [ ] 同一轮、同一页面只显示一张卡（最后一版）
- [ ] 不同页面仍各一张
- [ ] 回归测试覆盖

#### 相关

- DESIGN.md §54、docs/pages.md

## CB-022

**只读工具的结果没有卡片（只有文字）**  
里程碑：成熟度 Maturity · 标签：`type: feat` `area: chat` `P2`

#### 背景

读类工具（如 GitHub 列表 / 读文件、记忆搜索等）的结果目前只体现在机器人的文字里，没有像写操作确认卡、文件卡那样的可视卡片。需要先定规则：哪些读结果值得出卡、哪些只在开场一句里带过（§27）。

#### 验收标准

- [ ] DESIGN.md 写清读结果出卡的规则
- [ ] 按规则实现，结果卡不撑高聊天、不跳版
- [ ] 不增加首轮渲染时间

#### 相关

- DESIGN.md §27、§31、§53

## CB-023

**后台任务卡片在参数流完前显示笼统的「正在交给后台…」**  
里程碑：成熟度 Maturity · 标签：`type: bug` `area: chat` `P2`

#### 背景

delegate_task 的工具参数还在流式输出时（默认模型约 6–8 秒），任务卡片只显示「后台任务 · 正在交给后台…」。

#### 验收标准

- [ ] 参数里的任务名一出现就显示
- [ ] 或者在拿到名字前不出卡，只出一行进度
- [ ] §38.3 更新

#### 相关

- DESIGN.md §38

## CB-024

**切换暗色外观卡约 400ms**  
里程碑：成熟度 Maturity · 标签：`type: perf` `area: chat` `area: settings` `P2`

#### 背景

性能审计后仍未优化：4× CPU 下切换主题约 400–480ms 长任务（强制布局 + 毛玻璃重绘，不是 JS）。曾尝试切换时禁用过渡，无收益已回退。

#### 验收标准

- [ ] 4× CPU 下切换主题 INP < 200ms
- [ ] 外观不变
- [ ] 测量方法写进 docs 或 PR

#### 相关

- DESIGN.md §41

## CB-025

**打开长对话首屏渲染约 1 秒**  
里程碑：成熟度 Maturity · 标签：`type: perf` `area: chat` `P2`

#### 背景

切到一个很长的对话时有约 1 秒的长任务（§41.4 后宽屏 4× CPU 2584ms 到消息可见）。消息列表为了不跳版（§35）没有虚拟化。

#### 验收标准

- [ ] 长对话（>200 条）首屏到消息可见明显下降（目标 4× CPU < 1500ms）
- [ ] §35 不跳版的回归全部通过（tests/chat-scroll/regression.sh）

#### 相关

- DESIGN.md §35、§41

## CB-026

**chisabot_bot_threads：确认没有孤儿指针行**  
里程碑：成熟度 Maturity · 标签：`type: chore` `area: chat` `P2`

#### 背景

全端同步（§42）把每个（用户, 机器人）的当前对话存在 chisabot_bot_threads。删机器人时 agents/purge.ts 会删对应行，但删用户、清理前遗留的行、IM / 后台对话是否会留下孤儿指针还没核对。

#### 验收标准

- [ ] 生产只读统计孤儿行（agent 不存在 / thread 不存在）
- [ ] 有则加开机清理（可用环境变量关掉）并说明
- [ ] 删用户时级联

#### 相关

- DESIGN.md §42

## CB-027

**IM 定时推送受平台被动回复窗口限制**  
里程碑：成熟度 Maturity · 标签：`type: bug` `area: im` `area: schedules` `P2`

#### 背景

从 IM 设的定时任务到点后把回复推回 IM 会话。QQ 官方机器人、企业微信只允许在用户消息后的一段时间内被动回复，超出窗口推送会失败。

#### 验收标准

- [ ] 推送失败时在网页通知和定时任务记录里写明原因
- [ ] 支持主动消息的平台走主动接口
- [ ] docs/im.md 写清各平台限制

#### 相关

- DESIGN.md §49、§55；docs/im.md、docs/schedules.md

## CB-028

**「开场一句」只在显示时折叠，事件历史里仍保存**  
里程碑：成熟度 Maturity · 标签：`type: chore` `area: chat` `P2`

#### 背景

§27 的过程话只在渲染时变灰 / 折叠，保存的事件历史里仍有完整内容，会进入后续轮的上下文。

#### 验收标准

- [ ] 决定是否在服务端裁剪（不影响已保存对话的显示）
- [ ] 如裁剪，上下文 token 下降可测

#### 相关

- DESIGN.md §27

## CB-029

**弹窗打开动画仍有毛玻璃开销**  
里程碑：成熟度 Maturity · 标签：`type: perf` `area: settings` `P2`

#### 背景

§37.2 关闭和打开动画期间已去掉 backdrop-filter，但整体打开到首帧仍有 10–50ms 级的模糊开销，低端设备可感知。

#### 验收标准

- [ ] 低端设备（4× CPU）打开弹窗 INP < 100ms
- [ ] 外观不变

#### 相关

- DESIGN.md §37

## CB-030

**设备能力「打开」实际可执行任意命令，却标为非危险**  
里程碑：设备核心 Devices core · 标签：`type: bug` `area: devices` `area: pc` `P1`

#### 背景

2026-10-12 代码审查发现：PC 节点的 open 能力可以被用来执行任意命令，但被归类为非危险能力（不需要本机二次确认）。

#### 验收标准

- [ ] open 只能打开 URL / 文件 / 文件夹，不能带任意参数执行
- [ ] 或者把它归为危险能力并本机确认
- [ ] 测试覆盖绕过用例

#### 相关

- DESIGN.md §16；docs/pc-node.md

## CB-031

**本地对话事件表无上限增长**  
里程碑：成熟度 Maturity · 标签：`type: chore` `area: chat` `area: infra` `P2`

#### 背景

2026-10-12 代码审查：本地会话事件表没有保留策略，长期会无限增长。

#### 验收标准

- [ ] 给出保留策略（按对话 / 时间），不影响历史对话显示
- [ ] 迁移可回滚
- [ ] docs/operations.md 写明

## CB-032

**安卓签名改为 CI 内签名（需要仓库 Actions secrets）**  
里程碑：0.2.0 release · 标签：`type: chore` `area: android` `area: infra` `P2` `status: needs-user`

#### 背景

目前 APK 在部署机上离线签名，再把签名后的 APK 地址传给 CI。仓库所有者在 Settings → Secrets 加上 4 个 ANDROID_* secrets 后，CI 可以直接签名。

#### 验收标准

- [ ] 仓库所有者添加 ANDROID_* secrets
- [ ] release.yml 用 secrets 签名，去掉 signed_apk_url 路径（保留兼容一段时间）
- [ ] docs/releasing.md 更新

## CB-033

**生产跨部署 stale-chunk 测试待跑**  
里程碑：成熟度 Maturity · 标签：`type: chore` `area: infra` `P2`

#### 背景

PWA（§40）的跨部署旧分包自动刷新只在预览上验证过；生产上的脚本已准备好，等下一次部署后跑。

#### 验收标准

- [ ] 部署后跑一次，旧页面点进新分包页面能自动刷新一次
- [ ] 结果记在 docs/pwa.md

#### 相关

- docs/pwa.md

## CB-034

**用真实账号验证 GitHub 连接与 IM 接入**  
里程碑：成熟度 Maturity · 标签：`type: chore` `area: github` `area: im` `P2` `status: needs-user`

#### 背景

§49 IM 和 §53 GitHub 只用模拟服务和假令牌在生产验证过，用户还没有连接真实账号。

#### 验收标准

- [ ] 用户连接一个 fine-grained GitHub 令牌：读仓库 + 一次确认后的写操作
- [ ] 至少一个 IM 平台真实收发
- [ ] 问题逐条开 issue

## 已完成

最近合并的见 [ROADMAP「最近完成」](ROADMAP.md#最近完成) 和 [CHANGELOG](../CHANGELOG.md)。
