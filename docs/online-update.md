# 在线更新

ChisaBot 的三个客户端都能在线更新：网页、Windows PC 客户端、服务器本身（管理后台 → 系统更新）。

## 1. 网页：「有新版本，点此刷新」

- 镜像构建时写 `/app/build-info.json`（版本、提交、构建号 = 镜像标签、构建时间），前端打包时同一个构建号
  经 `VITE_CHISABOT_BUILD_ID` 进入 bundle（`app/src/lib/version.ts`）。
- `GET /api/version`（`server/src/build-info.ts`）返回 `{ version, commit, buildId, builtAt }`，`Cache-Control: no-store`。
  应用里不要求登录（和 `/health` 一样只有版本信息），公网网关照常先认证会话。
- 网页每 5 分钟（页面可见时）、切回前台 / 窗口获得焦点时（距上次 ≥ 30 秒）问一次；打开后 20 秒做第一次。
  构建号不同就在顶部居中显示玻璃胶囊「有新版本，点此刷新」（`components/update-banner.tsx`，DESIGN.md §22）。
  可以关掉，同一个构建号关掉后不再提示。开发环境（`dev`）永不提示。
- **从不自动刷新。** 用户点了刷新时，如果机器人还在回复（`channel-chat.tsx` 通过 `useReportBusy` 登记）或页面上有
  没发出去的文字，先弹确认框（`lib/activity.ts`）。
- 缓存：应用对 `index.html` 一律 `Cache-Control: no-cache`、带哈希的 `/assets/*` 永久缓存（直连 3001 时生效）；
  经公网网关时 `security-headers.conf` 对所有响应都是 `no-store`，入口页同样不会是旧的。没有 service worker。

## 2. PC 客户端（0.2.2 起）

- `electron-updater`（6.8.9）generic provider，更新源是公开目录 **`https://ayase.cn/downloads/chisabot-pc/`**：
  `latest.yml` + `ChisaBot-PC-<版本>-x64-setup.exe` + `.blockmap`（`pc/package.json` → `build.publish`）。
  `latest.yml` 里有安装包的 sha512，electron-updater 下载完会校验，不一致丢弃。
- **安装包没有代码签名**：`build.win.verifyUpdateCodeSignature = false`（`app-update.yml` 里就不写 `publisherName`，
  NsisUpdater 不做 Authenticode 校验），`pc/src/updater.js` 里再把校验函数设成通过。完整性靠 HTTPS + sha512。
  以后有了证书：去掉这两处，配置 `win.signtoolOptions.publisherName`。
- 行为（`pc/src/updater.js`）：开着「自动更新」（默认开）时启动 30 秒后检查一次、之后每 4 小时一次；发现新版本就在
  后台下载；下载好后弹本机窗口（`src/ui/update.html`，Skyglass 对话框）「新版本已下载，重启以安装」：
  **立即重启**（`quitAndInstall(静默, 装完自动打开)`）/ **稍后**（下次退出时自动安装）。托盘菜单多一项「重启以安装」。
- 网页 偏好设置 → 设备 → 这台电脑（「本机」标签）：「自动更新」开关、「客户端版本」行（当前 / 新版本 / 状态 / 下载进度）
  + 「检查更新」或「立即重启以安装」。关掉自动更新只停定时检查，手动检查照样能下载。
- 新 IPC 都经过来源检查：`pc:check-update`、`pc:install-update` 走 `handleWeb`（主窗口 + 顶层框架 + 已登录服务器）；
  `update:current`、`update:answer` 走 `handleLocal`（`src/ui/` 下的本机页面）。网页只能把「新版本已下载」窗口叫出来，
  立即重启要在本机窗口里由本人点。
- 只有 NSIS 安装版会更新（安装目录里有 `Uninstall ChisaBot PC.exe`）；开发运行和免安装 zip 显示「只有安装版能自动更新」。
- **0.2.1 及更早没有更新程序**：用户要手动装一次 0.2.2，之后就能自动更新。

发布（服务器 `/opt/chisabot-pc-build/`）：`build-022.sh`（electronuserland/builder:wine，限内存，跑 `node --test`，
`electron-builder --win nsis zip --x64 --publish never` 生成安装包、zip、`latest.yml`、`.blockmap`）→ `publish-pc.sh`：
复制到登录后可下载的 `/downloads/pc/`（网页「下载 PC 客户端」读的 `latest.json`），并把安装包、`.blockmap`、`latest.yml`
复制到公开更新源 `/opt/baiying-studio-site-20260714-1205/downloads/chisabot-pc/`（ayase.cn:443 的 newapi-proxy 提供，
`/downloads/chisabot-pc/` 单独一段 nginx，`Cache-Control: no-cache`）。**先放安装包，最后放 latest.yml**，客户端永远不会
看到指向不存在文件的 latest.yml。

## 3. 服务器：管理后台 → 系统更新

```
浏览器 ──▶ ChisaBot 容器（没有 docker socket）
             │  /api/admin/system-update（仅管理员）
             │  写 requests/<id>.json            读 state/state.json（只读挂载）
             ▼                                      ▲
   /opt/chisabot-updater/spool/requests     /opt/chisabot-updater/spool/state
             │                                      │
             └──▶ chisabot-updater（宿主机 root，systemd，python2）──▶ update.sh / rollback.sh
```

- 容器只能放三种请求：`check`、`update`、`rollback`。宿主机只认这三种动作，请求里的字符串从不执行；`update` 只能更新到
  本机镜像 `main` 的最新提交（请求里的 `expectCommit` 必须等于它，否则拒绝「main 已经变了」）。
- 认证就是文件系统权限：`spool/requests` 归 uid 1002（镜像里的 API 用户）、700；`spool/state` 归 root、只读挂载。
  公网网关先认证会话，`/api/admin/system-update` 再要求管理员。
- 同时只有一个任务：`/opt/chisabot-updater/update.lock`（flock，更新和回滚共用）；切换 compose 时再拿
  `/opt/openbot-zh/.deploy.lock`（和手动发布脚本同一把锁）。
- **更新来源**：本机裸仓库 `/opt/chisabot-updater/mirror.git`。仓库是私有的：
  - 有 `/opt/chisabot-updater/github-token`（root 600，**只读**的 fine-grained token，只给 Contents: Read）时，每 30 分钟和
    点「检查更新」时从 GitHub 拉 `main`（`git-askpass.sh`，令牌只在宿主机，从不进容器或前端）；
  - 没有令牌时读本机镜像本身，由发布者在推 GitHub 的同时推一份：`git push root@<host>:/opt/chisabot-updater/mirror.git main`。
- **update.sh** 步骤（与 `shared/system-update.ts` 的 `UPDATE_STEPS` 一致）：
  1. 准备：目标提交在 `main` 上，磁盘剩余 ≥ 2.5 GB；
  2. 检查依赖：`bun.lock`、各 `package.json`、`Dockerfile`、`docker/` 的指纹必须等于 `base-deps.sha256`（底座构建时的指纹），
     否则停下：「需要完整构建」（一键更新只替换代码层）；
  3. 备份：`pg_dump`、compose、profiles / workspace 卷 → `/opt/chisabot-updater/backups/<时间>-<任务>/`（保留 5 份）；
  4. 构建前端：`git archive` 导出源码，`node_modules` 硬链接自 `node_modules-base`，暂停原型沙箱，在限内存
     （3500m，无 swap 的 7.6 GB 机器）的容器里 `vite build`（注入构建号），结束后恢复沙箱；
  5. 构建镜像：`FROM` 压平底座 `flat-20261011b`（1 层），只覆盖 `app/dist`、`server/{src,drizzle,scripts}`、`shared`、
     `examples/zh-CN`、`build-info.json`，层数固定，不会碰到 127 层上限；标签 `auto-<UTC 时间>-<提交>`，标签
     `chisabot.commit` 记录提交；
  6. 切换：写回滚脚本 `/opt/openbot-zh/rollback-to-<旧标签>.sh`，`compose.yaml.before-<新标签>`，改镜像行，`docker compose up --wait`；
  7. 健康检查（`health.sh`）：容器 healthy、20 秒内没有重启、本机 `/health` 200、`https://ayase.cn:8443/login` 200、
     `/api/version` 的构建号是新的；**不通过就自动执行回滚脚本**，任务记为「已自动回滚」；
  8. 完成：只保留最近 3 个 `auto-*` 镜像，`docker image prune`。
- **回滚到上一版**（`rollback.sh`）：「上一版」= 当前镜像上线前的 compose（`compose.yaml.before-<当前标签>`，手动发布
  和一键更新都会留下）。只换镜像，数据库不回退（备份在 backups/）。
- 进度：脚本输出 `::step::` / `::error::` / `::result::` 标记，守护进程解析后把步骤、日志尾巴（60 行）写进 state.json，
  页面运行中每 2 秒刷新。守护进程重启（`KillMode=process`）不会打断正在跑的更新，新进程接着读日志。
- 审计：容器在请求被接受 / 拒绝时写 `configuration.changed`（`targetType: system_update`），宿主机写完一个任务后
  管理后台下次读取时补一条结果；宿主机自己另有 `/opt/chisabot-updater/audit.log`。
- 手动：`update.sh --job manual-xxxx --target <sha> --dry-run`（备份 + 构建，在切换前停下）、`--build-only --tag <标签>`
  （只构建镜像，供手动发布）。

### 安装（一次）

```sh
# 宿主机 root，在仓库的 deploy/updater/ 下
git push root@host:/opt/chisabot-updater/mirror.git main     # 先建镜像（install.sh 会 git init --bare）
cp -al /opt/chisabot-glass-build/src/node_modules /opt/chisabot-updater/node_modules-base   # 与 bun.lock 一致的依赖
bash install.sh <底座对应的提交>                               # 写 base-deps.sha256，装 systemd 服务
```

compose（`/opt/openbot-zh/compose.yaml`）的 openbot 服务加：

```yaml
    volumes:
      - /opt/chisabot-updater/spool/requests:/var/lib/chisabot-updater/requests
      - /opt/chisabot-updater/spool/state:/var/lib/chisabot-updater/state:ro
    environment:
      CHISABOT_UPDATER_DIR: /var/lib/chisabot-updater
```

依赖或底座变了（指纹不符）：按原来的方式完整构建并压平新底座，改 `config.env` 的 `BASE_IMAGE`、
`node_modules-base` 和 `base-deps.sha256`。
