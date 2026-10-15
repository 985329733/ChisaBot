# 部署、回滚与上线检查（维护者手册）

面向维护一个已经在跑的 ChisaBot 部署的人。第一次安装看 [README「给 AI 的部署引导」](../../README.md#给-ai-的部署引导)，
更新器的内部设计看 [online-update.md](../online-update.md)。本页不含任何真实主机名、IP、密钥或私人路径；具体部署的私有
信息由维护者自己保存在仓库之外。

路径约定（与 README 一致，可按自己的部署替换）：

| 路径 | 是什么 |
|---|---|
| `/opt/openbot-zh/` | 应用的 compose 目录（`compose.yaml`，容器 `openbot-zh`）、每次切换留下的回滚脚本 |
| `/opt/chisabot-updater/` | 宿主机更新服务：`request.sh`、`mirror.git`（main 镜像）、`spool/`、`backups/`、`config.env` |
| `/opt/openbot-zh/public/` | 公网网关（nginx）与登录服务的文件（`nginx.conf`、`auth/`、`auth-web/`） |

## 1. 正常上线一个 PR

1. PR 合并到 `main`（merge commit），记下合并提交 `<sha>`。
2. **只用串行部署脚本**：在宿主机上 `sh deploy-serial.sh <sha 前 7 位> <你的名字>`
   （脚本在仓库 [`scripts/ops/deploy-serial.sh`](../../scripts/ops/deploy-serial.sh)，拷到宿主机任意位置）。它会：
   - 拿 `flock /run/cb-deploy.lock`，同一时间只一个人部署，其他人排队；
   - 等 updater 空闲、没有排队请求、没有正在回答的对话（线程锁 = 0）；
   - `request.sh check` 拉最新 main，确认 main 包含你的提交（别人后来又合并了也没关系，一起上线）；
   - `request.sh update`：依赖没变 → 快速更新（只换代码层，约 1–2 分钟）；依赖 / Dockerfile 变了 → 完整构建（约 4–6 分钟）；
   - 退出码 0 = 已上线。3 = 等锁超时，4 = 对话一直在跑，5 = 你的提交不在 main，6 = 没切换成功（看 status 日志）。
3. **不要**直接运行 `update.sh` 或 `request.sh update`：前者页面看不到也会卡住按钮，后者会和别人的部署撞车。
4. 上线后跑**冒烟检查**（第 3 节）。

纯文档 / 流程类 PR（只改 `docs/`、`*.md`、`.github/` 模板）不需要部署：镜像里的网页和服务器没有变化。

## 2. 回滚

每次切换都会在 `/opt/openbot-zh/` 留下 `rollback-to-<上一版镜像标签>.sh` 和 `compose.yaml.before-<新标签>`。镜像标签形如
`local/chisabot:auto-<UTC 时间>-<提交前 7 位>`，所以文件名本身就说明回到哪一次提交。

```sh
ls -t /opt/openbot-zh/rollback-to-*.sh | head -3     # 最新的就是「回到上一版」
sh /opt/openbot-zh/rollback-to-auto-<时间>-<提交>.sh
```

- 网页上：设置 → 系统更新 →「回滚到上一版」，效果相同（只换镜像，数据库不回退）。
- 数据：每次一键更新前的 `pg_dump`、compose、卷快照在 `/opt/chisabot-updater/backups/<时间>-<任务>/`（保留 5 份）。
- ChisaBot 自己的表都是开机 `CREATE TABLE IF NOT EXISTS`、迁移只加可空列，所以回滚到旧镜像是安全的。**例外**：
  瘦身 P5 之后的 DROP 迁移不能只换镜像回滚，必须先恢复数据库（见 [slimming.md](../slimming.md)）。
- 手动改过的网关 / 登录服务文件：改之前在同目录留 `*.bak-<说明>-<日期>` 备份，必要时写一个 `rollback-<说明>-<日期>.sh`。

## 3. 冒烟检查（不碰任何真实对话）

1. `sh /opt/chisabot-updater/request.sh status` 显示刚才的任务成功；`/api/version` 的提交号是你的。
2. 管理员自检：设置 → 系统更新 →「自检」，或宿主机 `sh /opt/chisabot-updater/smoke.sh`（模型往返一次，什么都不保存，
   [admin-smoke.md](../admin-smoke.md)）。
3. 需要端到端时：用**一次性机器人 + 临时签发的会话**跑脚本，跑完删掉机器人和会话。绝不在用户自己的机器人和对话里测试。
4. 改到聊天 / 同步 / 滚动的 PR：跑 `tests/chat-scroll/regression.sh`（贴底、发送跳动、轮询、窄屏等 7 项）。

## 4. 不随一键更新的部分

| 部分 | 怎么更新 |
|---|---|
| 公网网关 nginx（`deploy/public/nginx.conf`） | 改模板 → 拷到网关目录 → `nginx -t` → reload；先留备份 |
| 登录服务（`deploy/public/auth/server.ts`、`auth-web/`） | 拷文件 → 重启 `openbot-web-auth`；会话库原地加列，已有登录不受影响。签名身份（[accounts.md](../accounts.md)；朋友账号已去掉）：顺序是 ① 登录服务 + `config.json` 的 `identitySecret` + nginx 新模板 ② 应用 `.env` 加同值 `CHISABOT_GATEWAY_SECRET` ③ 部署应用；回滚网关时先把 `.env` 里这一行去掉并重建应用容器 |
| 更新器自己（`deploy/updater/`） | 每次成功更新后自升级；老部署跑一次 `sh deploy/install-updater.sh` |
| PC / Android 客户端 | 发版流程：[releasing.md](../releasing.md)、[online-update.md](../online-update.md) §2 |
| Magpie 模型网关 | 独立 compose，手动 |

## 5. 并行开发时

多个 worker 同时开发时，每个人用自己的 worktree、预览容器和端口，部署一律走第 1 节的串行脚本。协议见
[dev/parallel-work.md](../dev/parallel-work.md)。
