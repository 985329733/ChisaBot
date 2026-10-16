# ROADMAP（看板）

ChisaBot 现在要做什么、接下来做什么、以后做什么。这一页就是看板：每一行指向 [BACKLOG](BACKLOG.md) 里一条带验收标准的条目
（GitHub Issues 打开后改为 issue 链接）和一个 [里程碑](https://github.com/ChisaAlter/ChisaBot/milestones)。

- **谁维护**：每个 PR 改自己那一行（开始做 → 「现在」，合并 → 「最近完成」）；主维护者每天过一遍，调整顺序、清理已完成。
- **方向**（2026-10-15）：尽快做成「相对成熟、可以分享给朋友用」的私人助手。核心是**在任何地方管理所有设备（包括本地电脑）**，
  云端机器人能读、改、写本地文件和代码；同时继续把上游 OpenBot 的企业功能瘦身掉；Hark 的能力逐项补齐。
- 上次整理：2026-10-15 14:10（对照 origin/main 23c58bf 逐行核对）。

## 里程碑

| 里程碑 | 目标 | 状态 |
|---|---|---|
| [Hark parity](https://github.com/ChisaAlter/ChisaBot/milestone/1) | 记忆、技能、保险箱、GitHub、页面、定时、文件/生图、审批、生图/识图设置已上线；对话体验第五轮（短气泡、干活卡）已上线；简报、Google 账号最后 | 9 / 11 已上线（剩简报、Google 账号） |
| [精简 Slim](https://github.com/ChisaAlter/ChisaBot/milestone/2) | P1–P5 收敛成私人助手（[docs/slimming.md](slimming.md)） | P1–P4b、P6-1…P6-4（企业闸门、SSO/SCIM、worker/、桌面端残留）、删语音、P4c-1（routines 并入定时任务）已上线；P4c 其余合并按依赖排；P5 删空表等 ≥ 2 周 |
| [设备核心 Devices core](https://github.com/ChisaAlter/ChisaBot/milestone/3) | 设备上的编码工具、无界面节点、完全访问、本地 agent | 编码工具 / 无界面节点 / 完全访问 / 本地 agent 已上线；待真机验证 |
| [成熟度 Maturity](https://github.com/ChisaAlter/ChisaBot/milestone/4) | 全量体验扫查 + 已知缺陷 / 性能尾巴 | 第 1、2、3 轮已上线（#115、#122、#124、#125；第 3 轮非聊天页面 #142、#144、#145） |
| [0.2.0 release](https://github.com/ChisaAlter/ChisaBot/milestone/5) | 下一次 PC + Android 发版，真机验证 | 待设备核心合并 |

## 现在（进行中）

| 条目 | 内容 | 里程碑 | 分支 |
|---|---|---|---|
| [CB-061](BACKLOG.md#cb-061) / [CB-062](BACKLOG.md#cb-062) | 云端 Claude Code：云端工作区节点 + Claude 登录（P1）→ Claude Code 标签页（P2）（[设计](cloud-claude-code.md)、ADR-0014） | 设备核心 | `feat/cloud-cc-*` |
| [CB-047](BACKLOG.md#cb-047) / [CB-050](BACKLOG.md#cb-050) | 长对话打开时历史晚到；商品推荐带图网格（向 Hark 看齐 第五轮） | 成熟度 / Hark parity | `feat/harkchat-*` |

## 接下来

| 条目 | 内容 | 为什么排在这 |
|---|---|---|
| [CB-018](BACKLOG.md#cb-018) | 用户电脑手动重装 PC 0.1.x（现在 0.1.9） | 需要用户；设备核心验收依赖它 |
| [CB-017](BACKLOG.md#cb-017) | 真机验证 Windows / 安卓 | 需要用户；0.2.0 发版前 |
| [CB-019](BACKLOG.md#cb-019) | 发版 0.2.0 | 设备核心 + 审批合并之后 |
| [CB-021](BACKLOG.md#cb-021) | 一轮两张同一页面卡片 | 小缺陷 |
| [CB-023](BACKLOG.md#cb-023) | 后台任务卡片笼统文字 | 小缺陷 |
| [CB-027](BACKLOG.md#cb-027) | IM 定时推送的平台窗口 | 需要真实平台验证 |
| [CB-034](BACKLOG.md#cb-034) | 真实账号验证 GitHub / IM | 需要用户 |

## 以后

| 条目 | 内容 | 条件 |
|---|---|---|
| [CB-063](BACKLOG.md#cb-063) / [CB-064](BACKLOG.md#cb-064) / [CB-065](BACKLOG.md#cb-065) | 云端 Claude Code P3 GitHub 工作区、P4 电脑同步（PC 新版）、P5 ChisaCloudCode 去留 | P2 上线后；P5 要问用户 |
| [CB-015](BACKLOG.md#cb-015) | 瘦身 P4c 其余合并（旧面板、components、responsibilities、审批规则…；routines 已并入定时任务 #143） | 各自依赖的功能上线并稳定后 |
| [CB-016](BACKLOG.md#cb-016) | 瘦身 P5 DROP 空表 | P4b 上线 ≥ 2 周 |
| [CB-013](BACKLOG.md#cb-013) | Google 账号连接 | 用户说不急，Hark parity 最后一项 |
| [CB-014](BACKLOG.md#cb-014) | 每日简报（可选） | 定时任务稳定后 |
| [CB-022](BACKLOG.md#cb-022) | 只读工具结果的卡片规则 | 先定设计 |
| [CB-024](BACKLOG.md#cb-024) / [CB-025](BACKLOG.md#cb-025) / [CB-029](BACKLOG.md#cb-029) | 主题切换、长对话首屏、弹窗模糊性能 | 性能轮 |
| [CB-026](BACKLOG.md#cb-026) / [CB-028](BACKLOG.md#cb-028) / [CB-031](BACKLOG.md#cb-031) | 数据卫生：线程指针、过程话、事件表 | 数据轮 |
| [CB-032](BACKLOG.md#cb-032) / [CB-033](BACKLOG.md#cb-033) | CI 内安卓签名、生产 stale-chunk 测试 | 发布流程 |

## 最近完成

| 日期 | 内容 | PR | 设计 / 文档 |
|---|---|---|---|
| 2026-10-16 | 「模型老断」：断线不再误报成连不上模型、自动接上；部署不再截断正在回答的一轮（CB-076） | 本 PR | DESIGN.md §89 |
| 2026-10-16 | 每个机器人记住操作状态；消息不再往回跳（CB-075） | 本 PR | DESIGN.md §88 |
| 2026-10-16 | 电脑文件夹导入失败不留半个工作区、删了的工作区不再挡住重新导入（CB-074） | 本 PR | DESIGN.md §87 |
| 2026-10-16 | 机器人 ↔ Claude Code 原地切换，不再整屏刷新（CB-072） | 本 PR | DESIGN.md §84 |
| 2026-10-16 | 打开对话落在最新一条、不跳；切机器人秒开；接入回放瘦身（CB-071） | 本 PR | DESIGN.md §83 |
| 2026-10-15 | 商品 / 地点推荐带图卡片网格（CB-050）、长对话历史晚到停在底部（CB-047） | #146 | DESIGN §72 |
| 2026-10-15 | 瘦身 P4c-1：上游 Routines 并入定时任务，只剩一套（CB-015，约 8.6k 行） | #143 | DESIGN §55、[slimming.md](slimming.md) |
| 2026-10-15 | 成熟度 3c：设置左栏三组可折叠、默认只展开当前页所在组，笔记本上不用滚（CB-058） | #145 | DESIGN §71.7 |
| 2026-10-15 | 成熟度 3b：管理页说中文（插件目录、权限规则、活动记录），手机上活动记录一条一张卡（CB-056、CB-057） | #144 | DESIGN §71.6 |
| 2026-10-15 | 成熟度 3：「待处理」只放等你点头的事、手机上完全访问时长按钮、找不到的错误卡、文案、资料页模型名（CB-051…CB-055） | #142 | DESIGN §71 |
| 2026-10-15 | 干活卡结束后收成一行「搜索 2 次 · 看了 3 个网页」、提示词去免责段（CB-049 完成） | #141 | DESIGN §70.2 |
| 2026-10-15 | 干活卡：「思考中」换成当前步骤 · 第几步 · 用时（CB-049） | #139 | DESIGN §70 |
| 2026-10-15 | 对话像发短信：短气泡、草稿卡、回复引用、代码卡、提示词第二版（CB-048） | #138 | DESIGN §69 |
| 2026-10-15 | 只有一套聊天：`/bot` 并入频道聊天、删语音（CB-046） | #136、#137 | DESIGN §68、ADR-0013 |
| 2026-10-15 | 重新生成 / 编辑后重发，所有设备一致（CB-042） | #129 | DESIGN §67 |
| 2026-10-15 | 朋友账号：邀请链接、网关签名身份、按人隔离（CB-040） | #128 | DESIGN §65、[accounts.md](accounts.md)、ADR-0011 |
| 2026-10-15 | 发版说明 v0.1.9（PC + Android，versionCode 215） | #127 | [releasing.md](releasing.md) |
| 2026-10-15 | 本地 agent（Claude Code / Codex / OpenCode）与权限档位 只读 / 工作区 / 完全访问（CB-007、CB-008） | #126 | DESIGN §66 · [local-agents.md](local-agents.md) · ADR-0010 |
| 2026-10-15 | 成熟度 4：窄屏页面卡片只留外链图标、登录页不预填（CB-044） | #125 | DESIGN §54 |
| 2026-10-15 | 频道聊天刷新 / 换设备接着看正在写的回答（CB-041 P0、CB-043） | #124 | DESIGN §64 |
| 2026-10-15 | 成熟度 2：只填名字建机器人、空聊天「试试这样问」（CB-003） | #122 | DESIGN §63 |
| 2026-10-15 | 瘦身 P6-4：删上游桌面端残留（electron 插件、组织登录、host-access），清理 .env.example（约 3.5k 行，完整构建） | #135 | [slimming.md](slimming.md) |
| 2026-10-15 | 瘦身 P6-3：删 worker/、Intelligence 开通脚本，去掉 SSO / SCIM / Expo / OTel 依赖（约 1.8k 行，完整构建） | #134 | [slimming.md](slimming.md) |
| 2026-10-15 | 朋友账号入口默认隐藏、网关邀请默认关（多用户以后再做；撤回 #130） | #133 | DESIGN §65、[accounts.md](accounts.md) |
| 2026-10-15 | 瘦身 P6-2：去掉 SSO / SCIM 插件与身份提供者分支（约 1.2k 行） | #132 | [slimming.md](slimming.md) |
| 2026-10-15 | 瘦身 P6-1：去掉上游企业控制闸门、`/api/admin/enterprise`、`/api/admin/people`、OTel 导出（约 5k 行） | #131 | [slimming.md](slimming.md) |
| 2026-10-15 | 瘦身 P4b-3：去掉自动学习、身份提供者管理接口、Docker supervisor 配置（约 3.0k 行） | #123 | [slimming.md](slimming.md) |
| 2026-10-15 | 瘦身 P4b-2：去掉推送与可达性、群聊、团队机器人接口，交接默认关（约 4.6k 行） | #121 | [slimming.md](slimming.md) |
| 2026-10-15 | 瘦身 P4b-1：服务器不再加载演示录制、上游个人记忆、主动研究、意图路由（约 7.8k 行） | #117 | [slimming.md](slimming.md) |
| 2026-10-15 | 设备核心：编码工具、完全访问、服务器节点 chisabot-node（0.1.8；CB-004/005/006） | #119 | DESIGN §62 · [pc-node.md](pc-node.md) §12–§14 · ADR-0009 |
| 2026-10-15 | 备用模型：管理员排好的回退顺序、对话里说明换了模型、自检走回退（CB-035） | #118 | DESIGN §61 · [models.md](models.md) |
| 2026-10-15 | 瘦身 P3：删不发布的上游目录（约 10 万行）+ CI「ChisaBot checks」修绿 | #113 | [slimming.md](slimming.md) |
| 2026-10-15 | 瘦身 P4a：删前端死页（约 1.2 万行） | #116 | [slimming.md](slimming.md) · DESIGN §57 |
| 2026-10-15 | 瘦身 P2：示例部署包精简、开机清孤儿授权 / 包技能 / 包频道 | #110 | [slimming.md](slimming.md) |
| 2026-10-15 | 成熟度 1：额度用完自动换模型、报错说人话、工具栏中文、部署等待页（CB-003） | #115 | DESIGN §60 |
| 2026-10-15 | 生图 / 识图模型在模型设置里配，每个人可覆盖（CB-002） | #114 | DESIGN §59 · [chat-files.md](chat-files.md) |
| 2026-10-15 | 确认卡片 + 设置 → 审批偏好（CB-001） | #112 | DESIGN §58 |
| 2026-10-15 | 项目维护与文档系统：ROADMAP / BACKLOG / ADR / 贡献指南 / 模板（CB-012） | #111 | [README](README.md) · [CONTRIBUTING](../CONTRIBUTING.md) |
| 2026-10-15 | 瘦身 P1：导航收敛 | #109 | DESIGN §57 |
| 2026-10-14 | 聊天文件与图片生成 | #108 | DESIGN §56 · [chat-files.md](chat-files.md) |
| 2026-10-14 | 定时任务与提醒 | #107 | DESIGN §55 · [schedules.md](schedules.md) |
| 2026-10-14 | 页面（可分享网页） | #105 #106 | DESIGN §54 · [pages.md](pages.md) |
| 2026-10-14 | GitHub 账号连接 | #104 | DESIGN §53 · [github.md](github.md) |
| 2026-10-14 | 密钥保险箱 | #103 | DESIGN §52 · [vault.md](vault.md) |
| 2026-10-14 | 技能 | #102 | DESIGN §51 · [skills.md](skills.md) |
| 2026-10-14 | 长期记忆 | #101 | DESIGN §50 · [memory.md](memory.md) |
| 2026-10-14 | IM 接入 | #99 #100 | DESIGN §49 · [im.md](im.md) |
| 2026-10-14 | 链接卡 | #98 | DESIGN §48 |
| 2026-10-14 | 0.1.7：设备默认「询问」、PC 连接提示 | #94 #95 #96 | DESIGN §45 · [pc-node.md](pc-node.md) |

更早的见 [CHANGELOG](../CHANGELOG.md)。
