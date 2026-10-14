# ChisaBot 文档

ChisaBot 是中文自托管 AI 助手平台，提供网页登录、本地会话持久化、可配置模型和 Magpie 多模型接入。以下指南从部署、使用到实现说明逐层展开。

## 从这里开始

| 我想… | 看这里 |
|---|---|
| 知道现在在做什么、接下来做什么 | [ROADMAP（看板）](ROADMAP.md) · [BACKLOG（带验收标准的条目）](BACKLOG.md) |
| 理解系统怎么搭的 | [ChisaBot 架构](architecture.md) · [架构决策记录 ADR](adr/README.md) |
| 改界面 | [DESIGN.md](../DESIGN.md)（顶部章节索引） |
| 提交改动 | [CONTRIBUTING](../CONTRIBUTING.md) · [并行开发协议](dev/parallel-work.md) |
| 上线 / 回滚 | [部署、回滚与上线检查](ops/deploy.md) · [在线更新](online-update.md) |

## 架构

- [ChisaBot 架构](architecture.md)：服务器 agent、公网网关、更新器、PC 节点、Android 外壳，以及**每个功能的代码位置、数据表和 DESIGN 章节**。
- [ADR](adr/README.md)：左栏只列机器人、设备属于账号、云端 agent + 设备节点、保险箱、页面沙箱、定时任务独立、版本归正、PR 与串行部署。
- [流式回复：从模型到屏幕](streaming.md)
- [分支与能力边界](chisabot.md)：本地模式、第三方推理、数据兼容和客户端状态。

## 功能文档（按范围）

| 范围 | 文档 | DESIGN |
|---|---|---|
| 模型 | [模型配置与切换](models.md) · [Magpie 深度集成](magpie.md) | §15 |
| 聊天 | [流式回复](streaming.md) · [聊天文件与图片生成](chat-files.md) | §24–§27、§30–§32、§35、§38、§42、§48、§56 |
| 设备 / PC / 手机 | [PC 节点与扫码绑定](pc-node.md) · [本地 agent 与权限档位](local-agents.md) · [手机网页版与 PWA](pwa.md) | §16、§33、§36、§40、§45、§62、§64、§66 |
| 记忆 | [长期记忆](memory.md) | §50 |
| 技能 | [技能](skills.md) | §51 |
| 保险箱 | [密钥保险箱](vault.md) | §52 |
| GitHub | [GitHub 账号连接](github.md) | §53 |
| 页面 | [页面（可分享网页）](pages.md) | §54 |
| 定时任务 | [定时任务与提醒](schedules.md) | §55 |
| IM | [IM 接入](im.md) | §49 |
| 工作流 | [工作流](workflows.md) | §26 |
| 瘦身 | [瘦身计划与进度](slimming.md) | §57 |

## 运维与部署

| 文档 | 适合解决的问题 |
| --- | --- |
| [快速开始](getting-started.md) | 第一次部署，配置完成后怎样开始聊天 |
| [自托管部署](../deploy/README.zh-CN.md) | 镜像、持久化、认证网关与 Magpie 部署模板 |
| [部署、回滚与上线检查](ops/deploy.md) | 合并后怎么上线、怎么回滚、上线后检查什么 |
| [在线更新](online-update.md) | 网页提示刷新、PC / Android 自动更新、系统更新（宿主机更新器） |
| [管理员自检](admin-smoke.md) | 不碰任何对话的模型往返检查 |
| [维护与排错](operations.md) | 备份、升级、连接故障与部署验收 |
| [来源与许可](THIRD_PARTY_NOTICES.md) | 上游项目与保留的许可证声明 |

需要找到具体答案：

- [在哪里填写模型 API 和密钥](models.md#管理员配置连接)
- [聊天输入框与 BOT 设置为什么是同一个值](models.md#bot-模型选择)
- [怎样让 Magpie 的多个模型进入选择器](magpie.md#配置顺序)
- [为什么 Magpie 模型多，而 ChisaBot 只显示少数](magpie.md#目录与调用密钥)
- [切换模型何时生效，运行中的回复使用哪个模型](models.md#目录缓存和运行快照)
- [模型不可用，怎样定位网关、权限或上游问题](operations.md#模型问题排查)

## 测试与验证

| 工具 | 用途 |
|---|---|
| `bun run typecheck` · `bun test` · 各包 `tests/` | 类型检查、单元 / 集成测试（ChisaBot 各功能的 server 测试在 `server/tests/<功能>*.test.ts`） |
| [`tests/chat-scroll/`](../tests/chat-scroll/README.md) | 聊天贴底 / 发送跳动 / 同步轮询回归（`regression.sh`，改聊天必跑） |
| `tests/dialog-close/` | 弹窗关闭性能探针 |
| `POST /api/admin/smoke` | 上线后的模型自检（[admin-smoke.md](admin-smoke.md)） |
| 一次性机器人 + 临时会话的生产 e2e | 只在需要时，跑完清理（[ops/deploy.md](ops/deploy.md) §3） |

## 发布

- [发版流程](releasing.md)：版本号、CI、GitHub Release、签名。
- [在线更新](online-update.md) §2：PC 外壳指纹与「重新安装」、Android 更新源。
- [Windows 签名](windows-signing.md)（上游）。
- 发版说明在 `.github/release-notes/`，变更记录在 [CHANGELOG](../CHANGELOG.md)。

## 开发实现

[模型配置](models.md#api-与保存结构) 说明 API、共享类型、数据库结构和权限；[运行快照](models.md#目录缓存和运行快照) 说明缓存及策略与执行的一致性；[Magpie 请求链路](magpie.md#每-bot-选择与请求链路) 说明网关对接。各页附有对应源码入口。

默认中文租户包见 [examples/zh-CN](../examples/zh-CN/README.md)。内部 `OPENBOT_*` 环境变量、包名、协议及数据目录保留兼容，展示品牌为 ChisaBot。

## 上游技术参考

以下资料继承自 [CopilotKit/OpenBot](https://github.com/CopilotKit/OpenBot)，用于查阅保留的工具、权限、框架与可选集成。Intelligence、上游镜像/发布基础设施和自动学习步骤，仅在选用相应能力时适用；本地自托管不要求 CopilotKit 托管服务。

- [OpenBot 原始架构](openbot-architecture.md)：上游服务、端口、电脑、工具及安全边界（ChisaBot 的见上面「架构」）。
- [环境配置](configuration.md)：环境变量和租户包 YAML。
- [开发参考](development.md)：迁移、分开启动服务与质量检查。
- [BOT 配置](coworkers.md)：持久配置、可见性、删除及外部 AG-UI 注册。
- [上游 routines](routines.md)（ChisaBot 的定时任务见 [schedules.md](schedules.md)）：后台工作进程、调度及执行身份。
- [自动学习](automatic-learning.md)：已在瘦身 P4b-3 删除（上游历史参考）。
- [联网研究](parallel-research.md)：Parallel Search 连接器。
- [Composio](plugins/composio.md)、[Google Drive](plugins/google-drive.md)、[Notion](plugins/notion.md)：按需配置的外部连接器。
- [上游容器参考](deployment.md)、[Kubernetes](../charts/openbot/README.md)：原镜像与平台资料。
- [上游发布参考](releasing.md)、[Windows 签名](windows-signing.md)：继承的发布和签名流程。
- [桌面模型 OAuth](../desktop/PROVIDER_OAUTH.md)、[桌面遥测](../desktop/TELEMETRY.md)：客户端可选配置。

文档只保存可复用说明与脱敏示例。真实登录密码、模型密钥、客户数据、对话和私人部署资料不写入文档或仓库。
