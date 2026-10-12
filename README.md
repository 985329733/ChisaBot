# ChisaBot

**中文、自托管、可配置模型的 AI 助手平台。**

ChisaBot 基于 [CopilotKit/OpenBot](https://github.com/CopilotKit/OpenBot) 的开源代码开发，保留 AG-UI、多 BOT、工具权限和审计能力，加入中文界面、独立的网页登录、本地会话持久化，以及 Magpie 模型目录与 BOT 模型选择。

本分支可通过 `OPENBOT_RUNTIME_MODE=local` 将会话保存在自己的 PostgreSQL 中，无需 CopilotKit Intelligence 项目。模型由管理员接入，可以是自托管模型、兼容 API 或自部署的 [Magpie](https://github.com/yetone/magpie) 网关。使用第三方模型时，推理仍由所选模型服务处理。

**开始使用：** [文档首页](docs/README.md) · [快速开始](docs/getting-started.md) · [模型配置与切换](docs/models.md) · [Magpie 深度集成](docs/magpie.md) · [自托管部署](deploy/README.zh-CN.md)

## 已有功能

- **中文界面**：聊天、BOT 管理、设置与管理页面中文化，内置中文租户包位于 `examples/zh-CN/`。
- **网页登录**：登录页面、服务端会话与退出登录，认证网关保护页面及 API。
- **本地运行与持久化**：本地运行模式使用 PostgreSQL 保存对话，重启后可继续查看会话。
- **模型配置**：管理员配置协议、API 地址、密钥与部署默认模型，并测试连接；密钥由服务端加密保存。
- **Magpie 模型目录**：读取网关实际开放的完整模型列表，保留供应商前缀，支持搜索和刷新。
- **每 BOT 独立选择**：聊天输入框与 BOT 设置修改同一个持久化值，两处及跨标签页同步，下一轮使用新模型。
- **工具与权限**：继承上游的 AG-UI 接入、BOT 电脑、MCP 工具、审批与审计，按部署配置启用。

目录表示当前网关连接向 ChisaBot 开放的模型，不表示全部供应商缓存，也不保证每个上游模型均可调用。具体权限、额度和服务状态由上游决定。

## 开发与部署

开发依赖：Bun 1.3.14、Docker 和 PostgreSQL。

```sh
bun install --frozen-lockfile
bun run typecheck
```

自托管模板及认证网关放在 `deploy/`，详见 [部署说明](deploy/README.zh-CN.md)。数据库连接、加密密钥、登录与模型连接需要按自己的环境配置。密码、模型密钥、数据库备份与浏览器资料不写入仓库。

本分支保留上游 `OPENBOT_*` 环境变量、内部包名、协议标识和数据目录，兼容已有部署和数据。产品展示名称为 **ChisaBot**。

`OPENBOT_SINGLE_USER=true` 只用于本地开发或由认证网关保护的内部服务；对外入口必须配置登录保护。详细能力边界与源码位置见 [分支说明](docs/chisabot.md)。

## 给 AI 的部署引导

> 写给代替人部署 / 维护 ChisaBot 的 AI 代理（以及照着做的人）。每一步都可以直接复制执行；方括号 `<...>` 是要替换的值。
> 规则：**不要打印、提交或回显任何密钥**（`.env`、`auth/config.json`、`private/`、证书、令牌）；**自检不要往真实对话里发消息**，一律用 `POST /api/admin/smoke`。
> 细节以这些文件为准：[`deploy/README.zh-CN.md`](deploy/README.zh-CN.md)、[`deploy/public/README.zh-CN.md`](deploy/public/README.zh-CN.md)、[`docs/online-update.md`](docs/online-update.md)、[`docs/admin-smoke.md`](docs/admin-smoke.md)、[`docs/magpie.md`](docs/magpie.md)、[`pc/README.md`](pc/README.md)。

### 0. 端口与组件一览

| 组件 | 监听 | 说明 |
| --- | --- | --- |
| ChisaBot 应用（容器 `openbot-zh`，Compose 项目 `openbot-zh`） | `127.0.0.1:3001` | 只绑 loopback，单管理员后端，**绝不直接对外** |
| 登录服务（容器 `openbot-web-auth`，host 网络） | `127.0.0.1:3002` | Argon2id 密码 + 会话，网关 `auth_request` 调它 |
| 公网网关（容器 `openbot-public-gateway`，nginx，host 网络） | `:8443` TLS | ChisaBot 入口 `https://<域名>:8443` |
| 同一网关的 Magpie 管理入口 | `:2053` TLS | 备用入口；日常用「管理后台 → 模型平台 Magpie」（同源 `/magpie-admin/`） |
| Magpie 模型网关（Compose 项目 `magpie`，可选） | `127.0.0.1:3425`（API）、`127.0.0.1:3430`（管理） | 应用经 Docker 网络 `http://magpie:3425/v1` 访问 |
| 宿主机更新服务 `chisabot-updater`（systemd，python2） | 无端口 | 读 `/opt/chisabot-updater/spool/requests` 请求文件 |
| PC 客户端更新源 | 任意静态 HTTPS 目录 | 本部署是 `https://ayase.cn/downloads/chisabot-pc/` |

8443 与 2053 都在 Cloudflare 允许代理的 HTTPS 端口里，所以可以开橙色云。

### 1. 前置条件

- Linux x86_64，root；内存 ≥ 4 GB（一键更新构建限 3500 MB），磁盘剩余 ≥ 2.5 GB（更新脚本会检查）。
- Docker Engine + Docker Compose v2、git、curl、python2（`chisabot-updater` 用）、Bun 1.3.14（构建前端）。
- 域名与证书：`/etc/letsencrypt/live/<域名>/{fullchain.pem,privkey.pem}`（目录不同就在 `deploy/.env` 设 `CHISABOT_CERT_DIRECTORY`）。

```sh
docker --version && docker compose version && git --version && python2 --version && bun --version
```

### 2. 获取代码

仓库是私有的，需要有读权限的账号或只读令牌。

```sh
git clone https://github.com/ChisaAlter/ChisaBot.git /opt/chisabot-src
cd /opt/chisabot-src
bun install --frozen-lockfile
```

### 3. 环境变量与密钥（只列名字）

```sh
cp deploy/.env.example deploy/.env && chmod 600 deploy/.env
# 只给空字段生成随机值，不打印：
bun -e 'let t=await Bun.file("deploy/.env").text();for(const n of ["KEY_ENCRYPTION_KEY","WORKER_SHARED_SECRET"]){t=t.replace(new RegExp("^"+n+"=\\s*$","m"),n+"="+require("node:crypto").randomBytes(32).toString("hex"))}await Bun.write("deploy/.env",t)'
```

`deploy/.env` 里的变量：

| 变量 | 必填 | 作用 |
| --- | --- | --- |
| `KEY_ENCRYPTION_KEY` | 是 | 加密数据库里的模型密钥；**必须与数据库备份一起保存，已有安装绝不能重置** |
| `WORKER_SHARED_SECRET` | 是 | 例行任务 worker 与服务器之间的共享密钥 |
| `OPENBOT_RUNTIME_MODE` | 是（`local`） | 会话存自己的 PostgreSQL，不需要 CopilotKit Intelligence |
| `BOT_PROVIDER`、`BOT_MODEL`、`OPENAI_API_KEY` / `OPENAI_BASE_URL`、`ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL` | 首次启动用 | 首个模型连接；之后在「管理后台 → 模型设置」改并测试 |
| `CHISABOT_IMAGE` | 否 | 镜像名，默认 `local/chisabot:latest` |
| `MAGPIE_NETWORK` | 否 | 与 Magpie 共用的 Docker 网络，默认 `openbot_magpie` |
| `MAGPIE_ADMIN_URL`、`MAGPIE_WEB_KEY_FILE` | 用 Magpie 时 | 内嵌管理控制台：`http://magpie:3430` + 只读 Web key 文件（uid 1002、0400） |
| `MODEL_CATALOG_REFRESH_MINUTES` | 否 | 模型目录刷新间隔，默认 10 |
| `SL_ENABLED`、`COPILOTKIT_TELEMETRY_DISABLED`、`DO_NOT_TRACK` | 否 | 关闭上游遥测 |
| `DEPLOYMENT_ID`、`VITE_MAGPIE_MANAGEMENT_URL` | 否 | 部署标识；后者已不用于导航 |

Compose 里固定写好的：`EMBEDDED_POSTGRES=on`（数据库在容器内，卷 `database`）、`OPENBOT_SINGLE_USER=true`（**只因为前面有登录网关才安全**）、`TENANT_PACKAGE_DIR=../examples/zh-CN`；启用在线更新后再加 `CHISABOT_UPDATER_DIR`（见第 7 步）。
其他私密文件：`deploy/private/magpie.env`（`MAGPIE_WEB_KEY`）、`deploy/public/auth/config.json`、`deploy/public/magpie-private.conf`。都被 Git 忽略，不要提交。

### 4. 构建并启动应用

```sh
cd /opt/chisabot-src
TENANT_PACKAGE_DIR=../examples/zh-CN bun run --cwd app build     # start.sh 要求 app/dist 已存在
sh deploy/start.sh                                                # 建 Magpie 网络，build + up --wait openbot
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3001/health   # 期望 200
curl -s http://127.0.0.1:3001/api/version                               # {version, commit, buildId, builtAt}
```

可选 Magpie（在 `deploy/` 下；已有安装复用 `private/magpie.env` 与 `magpie-data`，不要重新生成 Web key）：

```sh
cd deploy
install -d -m 700 private magpie-data
umask 077; { printf 'MAGPIE_WEB_KEY='; openssl rand -hex 32; } > private/magpie.env
docker compose --env-file .env -p magpie -f magpie.compose.yaml up -d --wait
```

可选定时任务（例行任务、附件清理）：`CHISABOT_ENABLE_TIMERS=1 sh deploy/start.sh`（root + systemd）。

### 5. HTTPS 网关与首个管理员

管理员账号就是登录网关的账号（Argon2id 哈希写进 `deploy/public/auth/config.json`）。按 [`deploy/public/README.zh-CN.md`](deploy/public/README.zh-CN.md)「初始化认证配置」执行：密码用 `read -s` 读、经 stdin 传入，**不要放进命令参数或日志**；AI 代理应让人自己输入密码。

```sh
cd /opt/chisabot-src/deploy/public
sed -i 's/chisabot\.example\.com/<域名>/g' nginx.conf          # Origin 白名单、Host 校验、证书路径都要换
umask 077; printf 'proxy_set_header Cookie "";\n' > magpie-private.conf   # 未启用 Magpie 时；启用后按文档生成
# ……按文档生成 auth/config.json（publicOrigin 必须与 https://<域名>:8443 完全一致）……
docker compose --env-file ../.env -p openbot-public -f compose.yaml run --rm --no-deps gateway nginx -t
docker compose --env-file ../.env -p openbot-public -f compose.yaml up -d --wait
curl -s -o /dev/null -w '%{http_code}\n' https://<域名>:8443/login      # 期望 200
```

防火墙只开 8443、2053（以及你自己的 PC 更新源所在的 443）；3001 / 3002 / 3425 / 3430 保持 loopback。
登录后第一件事：「管理后台 → 模型设置」配置连接并点「测试」。首次打开时系统会自动建一个私有的默认「助手」机器人。

### 6. 自检（不碰任何对话）

```sh
curl -s -X POST -H 'content-type: application/json' -d '{}' http://127.0.0.1:3001/api/admin/smoke
# 期望 "ok":true 且 "persisted":false；装了更新服务后也可以：
sh /opt/chisabot-updater/smoke.sh [机器人 id]     # 失败时退出码非 0
```

网页上：管理后台 → 系统更新 →「自检」。**禁止**用「在某个机器人对话里发一句 ok」来验证。

### 7. 在线更新服务（管理后台 → 系统更新）

在宿主机安装一次（详见 [`docs/online-update.md`](docs/online-update.md)）：

```sh
cd /opt/chisabot-src/deploy/updater
git init --bare -q /opt/chisabot-updater/mirror.git 2>/dev/null || true
git -C /opt/chisabot-src push /opt/chisabot-updater/mirror.git HEAD:main           # 本机镜像仓库
cp -al <与 bun.lock 一致的 node_modules> /opt/chisabot-updater/node_modules-base     # 硬链接复制
vi config.env        # COMPOSE_DIR、BASE_IMAGE（压平的底座镜像）、PUBLIC_HEALTH_URL=https://<域名>:8443/login、BUILD_MEMORY 等
bash install.sh <底座镜像对应的提交>                  # 写 base-deps.sha256，安装并启动 systemd 服务 chisabot-updater
systemctl is-active chisabot-updater                   # active
```

再给 compose 的 `openbot` 服务加挂载与变量，然后 `docker compose up -d --wait`：

```yaml
    volumes:
      - /opt/chisabot-updater/spool/requests:/var/lib/chisabot-updater/requests
      - /opt/chisabot-updater/spool/state:/var/lib/chisabot-updater/state:ro
    environment:
      CHISABOT_UPDATER_DIR: /var/lib/chisabot-updater
```

新提交怎么到服务器：

- 有 `/opt/chisabot-updater/github-token`（root 600，fine-grained，**只给 Contents: Read**）时，每 30 分钟和点「检查更新」时自动从 GitHub 拉 `main`；
- 没有令牌时，发布者推 GitHub 的同时推一份到本机镜像：`git push root@<主机>:/opt/chisabot-updater/mirror.git main`（或用 `git bundle` 增量包 + `git fetch`）。

一键更新只替换代码层：`bun.lock`、各 `package.json`、`Dockerfile`、`docker/` 的指纹必须等于 `base-deps.sha256`，否则会停在「需要完整构建」——这时按原方式完整构建并压平新底座，更新 `config.env` 的 `BASE_IMAGE`、`node_modules-base` 和 `base-deps.sha256`。
手动演练（备份 + 构建，切换前停下）：`/opt/chisabot-updater/update.sh --job manual-test --target <40 位提交> --dry-run`。

### 8. 网页与 PC 客户端的更新

- **网页**：无需配置。镜像构建号变了，`/api/version` 返回新 `buildId`，页面顶部出现「有新版本，点此刷新」（从不自动刷新）。
- **PC 客户端**（Windows，Electron，`pc/`）：0.2.2 起用 electron-updater 的 generic 更新源（`pc/package.json` → `build.publish.url`）。发布新版：

```sh
cd pc
npm version <新版本> --no-git-tag-version     # 版本号必须变大，否则 0.2.x 客户端不会更新
npm ci && npm test
npx electron-builder --win nsis zip --x64 --publish never   # Linux 上需要 wine：用 electronuserland/builder:wine 容器（docker run --memory 3000m …）
# 产物 dist/：ChisaBot-PC-<版本>-x64-setup.exe、.blockmap、-portable.zip、latest.yml
```

发布到更新源目录（要求 `Cache-Control: no-cache`）：**先放安装包和 .blockmap，最后放 latest.yml**；保留上一版安装包和 .blockmap（差分下载）。然后核对：

```sh
curl -s https://<更新源>/latest.yml                              # version 是新版本
curl -s https://<更新源>/ChisaBot-PC-<版本>-x64-setup.exe | openssl dgst -sha512 -binary | base64 -w0   # 必须等于 latest.yml 的 sha512
```

安装包没有代码签名（完整性靠 HTTPS + sha512）；只有 NSIS 安装版会自动更新，0.2.1 及更早的用户要手动装一次新版。

### 9. 回滚

- 网页：管理后台 → 系统更新 →「回滚到上一版」（只换镜像，数据库不回退）。
- 宿主机：每次切换都会留下 `/opt/openbot-zh/rollback-to-<旧标签>.sh` 和 `compose.yaml.before-<新标签>`：

```sh
ls -t /opt/openbot-zh/rollback-to-*.sh | head -3
sh /opt/openbot-zh/rollback-to-<旧标签>.sh
```

- 数据：一键更新前的 `pg_dump`、compose、profiles / workspace 卷在 `/opt/chisabot-updater/backups/<时间>-<任务>/`（保留 5 份）。
- PC：把更新源里的 `latest.yml` 换回上一版的（`allowDowngrade` 关闭，已升级的客户端不会降级，只会停止再升级）。

### 10. 健康检查清单

```sh
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}' | grep -E 'openbot|magpie'   # 都是 healthy
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3001/health               # 200
curl -s http://127.0.0.1:3001/api/version                                           # buildId = 当前镜像标签
curl -s -o /dev/null -w '%{http_code}\n' https://<域名>:8443/login                   # 200
docker exec openbot-public-gateway nginx -t
systemctl is-active chisabot-updater
git --git-dir=/opt/chisabot-updater/mirror.git log --oneline -1 main               # 系统更新页能看到的最新提交
sh /opt/chisabot-updater/smoke.sh                                                    # "ok":true,"persisted":false
```

更新服务自己的健康检查（`deploy/updater/health.sh`）就是：容器 healthy、20 秒内不重启、本机 `/health` 200、公网登录页 200、`/api/version` 构建号是新的，不通过自动回滚。

### 11. 常见坑

- **把 3001 直接暴露到公网**：后端是 `OPENBOT_SINGLE_USER=true`，谁能访问谁就是管理员。只能经 8443 网关。
- **重置了 `KEY_ENCRYPTION_KEY`**：已保存的模型密钥全部解不开。随数据库备份一起保存。
- **`nginx.conf` 里还有 `chisabot.example.com`**，或 `auth/config.json` 的 `publicOrigin` 与实际入口（含 `:8443`）不一致：登录后跨站校验失败、Cookie 不共享。
- **忘了先构建前端**：`start.sh` 直接报 `Build the frontend first`。
- **镜像层数**：反复在旧镜像上叠层会撞到 127 层上限；一键更新基于压平的底座只加固定层，手动发布也应在压平底座上构建。
- **改了依赖却点一键更新**：会停在「需要完整构建」，这是预期行为，不是故障。
- **系统更新页看不到新提交**：仓库私有且宿主机没有令牌时，必须同步 `mirror.git`（第 7 步）。
- **小内存机器构建 OOM**：保持 `BUILD_MEMORY`（默认 3500m）和 PC 构建的 `--memory 3000m`；构建期间更新脚本会暂停 `PROTO_CONTAINERS` 里的容器。
- **PC 版本号没变**：客户端认为没有新版本；latest.yml 先于安装包上线：客户端会下载失败。
- **Cloudflare 代理**：只能用它支持的端口（8443、2053 可以）；更新源和 `latest.yml` 不要被缓存（`no-cache`）。个别用户的本地 DNS 若被污染，表现为自签证书 / 403，属于客户端网络问题。
- **Magpie 升级**：模板固定已验证的镜像 digest，升级前先备份配置并单独验证；一键更新不管 Magpie 和登录网关，它们按各自文档手动更新。

## 目录

| 路径 | 内容 |
| --- | --- |
| `app/` | 中文 Web 界面 |
| `server/` | API、本地运行、模型配置、BOT 与工具权限 |
| `shared/` | 前后端共享类型与协议 |
| `examples/zh-CN/` | 中文品牌、BOT、频道和技能配置 |
| `deploy/` | 自托管部署与认证网关 |
| `pc/` | ChisaBot PC（Windows，Electron）客户端：设备节点 + 在线更新 |
| `deploy/updater/` | 宿主机在线更新服务（管理后台 → 系统更新） |
| `desktop/`、`mobile/` | 继承上游的桌面和移动客户端源码（未作为 ChisaBot 客户端发布，没有在线更新） |
| `docs/` | 中文使用指南、模型集成与上游技术参考 |

上游 Intelligence、第三方连接器与发布流程按需使用。桌面和移动源码保留上游的安装、OAuth 和发布集成，分发前需按自己的环境配置并构建；本仓库不提供 ChisaBot 公共镜像。Windows PC 客户端（`pc/`）的安装包由部署者自己构建并放到自己的更新源（见上文第 8 步）。

## 来源与许可证

- 上游项目：[CopilotKit/OpenBot](https://github.com/CopilotKit/OpenBot)
- 交互协议：[AG-UI](https://github.com/ag-ui-protocol/ag-ui)
- 模型网关：[yetone/magpie](https://github.com/yetone/magpie)

代码继续使用 [MIT License](LICENSE)，保留上游 `Copyright (c) 2026 CopilotKit` 及原有许可声明。ChisaBot 是在上游基础上定制的分支。
