# 瘦身：从「企业 AI 同事平台」收敛成私人助手（2026-10-14 起）

依据：2026-10-14 的整体审查（上游 OpenBot 继承功能逐项评估），用户批准按建议分阶段做。原则是**先入口、后代码、最后数据**；每阶段一个 PR，走正常的 PR → 合并 → 一键更新 → 自检，出问题回滚镜像。

| 阶段 | 内容 | 数据库 |
|---|---|---|
| P1 导航收敛 | 顶栏去分段、左栏只留机器人、账号菜单与设置左栏重排、旧地址重定向、右栏去掉上游旧面板（DESIGN.md「导航收敛」一节） | 不动 |
| P2 孤儿数据与示例包 | 见下 | 只删孤儿行 |
| P3 删不发布的目录 | 上游 Tauri 桌面端、Expo 移动端、外部框架适配器、Helm、SPIRE、supervisor 等 | 不动 |
| P4a 删前端死页 | 已经重定向 / 隐藏的上游页面和组件 | 不动 |
| P4b 关服务端模块 | 不再构造无数据的上游模块（表保留） | 不动 |
| 以后 | 与审批、保险库、账号合并的部分；观察稳定后再一次性 DROP 空表 | — |

## P2 孤儿数据与示例包

- **示例部署包 `examples/zh-CN`** 不再自带机器人和频道：每个人第一次进来会自动得到一个私有的「助手」（`ensureDefaultBot`），其他机器人自己新建。部署共享技能只留两个与具体连接器无关的：公开信息研究、核实说法。知识来源示例去掉。
- **开机清理**（`server/src/package-orphans.ts`，在部署包同步的同一个事务里跑，幂等，`CHISABOT_ORPHAN_SWEEP=0` 关掉）：
  1. 包里已经不声明的包技能（`origin = catalogue`、没有主人）连同工具声明与授权；用户自己写的技能不动。
  2. 包里已经不声明、且从没被当成对话用过（没有成员、没有映射）的包频道；用过的留着，那是历史对话。
  3. 授给已删除 / 不存在的机器人的 `plugin_grants`。
  1、2 只在库里只有这一个部署包时做（技能表按名字全局共享，多包时分不清是谁不要了）。
- **删机器人时**同一个事务里收回它的 `plugin_grants`。
- 上线前在生产 `pg_dump` 了受影响的表（`skills`、`skill_tools`、`plugin_grants`、`channels`、`channel_agents`）到 `/opt/openbot-zh/backups/`，恢复就是把这份 SQL 导回去。

## P3 删不发布的目录（2026-10-15）

先核对过哪些目录进发布物：服务端镜像（根 `Dockerfile` / `deploy/Dockerfile.zh` 只拷 `app server shared examples scripts agent-computer docker`）、PC 客户端 `pc/`（Electron）、Android `android/`、CI（`chisabot.yml`、`release.yml`、`security_zizmor.yml`）。这些一律保留。删掉的都不进任何发布物：

| 删除 | 原来是什么 |
|---|---|
| `desktop/` | 上游 Tauri 桌面端（ChisaBot PC 用 `pc/`） |
| `mobile/` | 上游 Expo 移动端（Android 用 `android/`） |
| `agent-adk/ag2/agno/bot/claude-sdk/crewai/langgraph/langgraph-agui/langroid/llamaindex/mastra/microsoft/pydantic-ai/strands` | 外部框架适配器（`agent-computer` 保留，它进镜像） |
| `charts/`、`spire/`、`supervisor/` | Helm chart、SPIRE 身份、每机器人一台计算机的 supervisor 进程 |
| `examples/{langgraph-bot,mastra-bot,pydantic-ai-bot}` | 上游示例（`examples/fintech` 还是测试夹具，暂留） |
| 根 `docker-compose.yml`、`scripts/{start,stop,processes,require-bash}.sh` 及其测试 | 上游笔记本全栈（起 agent-bot / agent-langgraph / supervisor / SPIRE）；ChisaBot 部署走 `deploy/start.sh` |
| `.github/workflows/{ci,desktop,desktop-signing,publish-release,release-pr}.yml`、`.github/published-images.json` | 上游的全量手动 CI、桌面端构建签名、往 ghcr.io/copilotkit 发镜像的发布流程 |
| `Tauri-signing-SKILL.md`、`prompt.txt`、`scripts/check-new-values-keys.ts`、`scripts/check-rendered-chart.ts` | 上游遗留 |
| 只测被删目录的测试 | `tests/{agent-bot,compose}.test.ts`、`server/tests/{learning-mastra,mobile-links,handoff-caps-defaults}.test.ts`，`connector-tokens-never-reach-computer` 去掉 supervisor 那一半 |

**刻意没动：** `worker/`（根 workspaces、两个 Dockerfile 和更新器的依赖指纹都列着它，删它会让依赖指纹变化、触发一次完整构建）——放到 P4b 和去掉 Slack/Teams/Twilio 依赖一起做，只做一次完整构建。依赖指纹（`bun.lock`、各 `package.json`、`Dockerfile`、`docker/`）在 P3 里一个字节都没改，所以这次是快速更新。

**修好「ChisaBot checks」：** CI 的 `bun install` 默认是隔离链接，`shared/` 不是 workspace，里面 import 的 `zod`、`@json-render/core`、`@json-render/react/schema` 只在 `server/`、`app/` 的 node_modules 里，所以 server typecheck 报 TS2307 再连锁一串 TS7006，bun 测试运行时也解析不到（镜像一直用 `--linker hoisted`，所以本地是绿的）。现在 CI 和镜像一样 `bun install --frozen-lockfile --linker hoisted`；`app` 里两处 `@ag-ui/client`（没声明的传递依赖）改成从 `@ag-ui/core` / `@copilotkit/react-core/v2` 取类型；CI 先 `app build`（重新生成 `routeTree.gen.ts`，提交里的那份总落后于并行 PR 新加的路由）再 `app typecheck`。

## P4a 删前端死页

P1 已经隐藏 / 重定向的上游页面，这一步把代码删掉（约 1.2 万行，只改网页，服务器与数据库不动）：

- **页面**：管理后台 人员与角色、企业控制、身份提供者、自动学习、组件游乐场、旧的管理员设备页；设置 → UI 组件库；群聊 `/group/*`。地址都保留成重定向（去 设置、设置 → 技能、设置 → 设备、对话）。
- **机器人设置窗**去掉「交接」「例行任务」两栏；接管窗口去掉「录制成工作流…」。
- **只被它们用到的组件 / lib** 一起删：gallery、carousel、questionnaire、主动研究面板、可达性（delivery）、群聊、旧记忆（`lib/memory.ts`）、主动研究（`lib/proactive.ts`）、演示录制（`lib/demonstrations.ts`）、旧技能编辑、旧例行任务列表、人员 / 企业 / 身份提供者 / 学习的查询与修改等；对应的 10 个测试文件。
- 测试夹具里 `mock.module("@/components/layout/sidebar-toggle")` 改成提供全部导出（bun 的模块 mock 会漏到后面的文件里，缺 `TopBarOwnsSidebarToggle` 会在 glass-shell 处报「测试之间未处理的错误」）。
- 不动：审批 / 确认卡、设备、定时任务、保险箱、GitHub、页面、聊天文件 / 图片、模型设置、IM、技能、记忆、例行任务后端。

## P4b 关服务端模块（表保留）

原则：模块不再构造、路由不再挂载、代码删掉；**数据库表和旧数据一律不动**（回滚镜像即可恢复，DROP 留到 P5）。分几个小 PR 做：

| PR | 模块 | 处理 | 前端 |
|---|---|---|---|
| P4b-1 | 演示录制（`/api/demonstrations/*`，`demonstrations/` 的 store/recording/draft/schedule/routes） | 删 | P4a 已删「录制成工作流…」与 `lib/demonstrations.ts` |
| P4b-1 | 上游个人记忆（`/api/memory`、`memory/` 的 store/ingestion/routes，每分钟的 `memorySweep`） | 删；§50 的长期记忆（`memory-notes/`）不受影响，`memory/tools.ts` 里每轮读记忆的中间件保留 | P4a 已删 `lib/memory.ts` |
| P4b-1 | 主动研究（`/api/proactive/*`，`proactive/` 的 engine/store/routes） | 删；`proactive/restriction.ts`、`private-share.ts` 是通用的只读 / 私密分享守卫，保留。生命周期重置仍会清旧的 `proactive.run` 队列行 | P4a 已删 `lib/proactive.ts` |
| P4b-1 | 意图路由（`POST /api/route`，`routing/` 的 classify/routes/service） | 删；`routing/model.ts`（工具选择用的模型补全）保留。审计类型 `channel.routed` 不再写，旧行照常显示 | 删 `lib/channels/route.ts`；「选了机器人再开对话」不再先发一条路由审计 |
| P4b-2 | 推送与可达性（Slack / Teams / 短信 Twilio / 手机推送，`/api/delivery*` 与 webhooks，`delivery/` 的 router/routes/opentag/push/twilio） | 删；`delivery/store.ts`、`types.ts` 保留（`delivery_*` 表、Slack 触发器读绑定表时用）；内部的 `deliveryNotifications` 变成空操作。生产没有配置任何推送通道、绑定 0 条 | P4a 已删 `lib/delivery.ts`、`/reachability` 重定向 |
| P4b-2 | 群聊（`/api/groups`） | 路由删掉；`channels/group.ts` 里的群聊服务保留（只被机器人交接用，交接也默认关了）。旧的多机器人对话打开时显示「已不再支持」 | 删 `/group` 链接（左栏、对话页跳转、频道事件里的群聊刷新） |
| P4b-2 | 团队机器人（`/api/team-bots`） | 路由删掉；`team-bots/team-bots.ts` 的访问判断保留（机器人一律私有后只是一条恒为自己的路径） | 删同意卡片 `team-bot-consent` 与 `lib/team-bots` |
| P4b-2 | 机器人之间交接（`hand_off`、群里 @ 别的机器人） | `BOT_HANDOFF_MAX_DEPTH` 默认改为 `0`：不给工具、不跑交接队列；设成 `1` 恢复上游行为 | 机器人设置窗里外部机器人的「回调令牌」面板删掉（外部框架适配器 P3 已删） |
