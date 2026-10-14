# ROADMAP（看板）

ChisaBot 现在要做什么、接下来做什么、以后做什么。这一页就是看板：每一行指向 [BACKLOG](BACKLOG.md) 里一条带验收标准的条目
（GitHub Issues 打开后改为 issue 链接）和一个 [里程碑](https://github.com/ChisaAlter/ChisaBot/milestones)。

- **谁维护**：每个 PR 改自己那一行（开始做 → 「现在」，合并 → 「最近完成」）；主维护者每天过一遍，调整顺序、清理已完成。
- **方向**（2026-10-15）：尽快做成「相对成熟、可以分享给朋友用」的私人助手。核心是**在任何地方管理所有设备（包括本地电脑）**，
  云端机器人能读、改、写本地文件和代码；同时继续把上游 OpenBot 的企业功能瘦身掉；Hark 的能力逐项补齐。
- 上次整理：2026-10-15。

## 里程碑

| 里程碑 | 目标 | 状态 |
|---|---|---|
| [Hark parity](https://github.com/ChisaAlter/ChisaBot/milestone/1) | 记忆、技能、保险箱、GitHub、页面、定时、文件/生图已上线；审批、生图/识图设置在做；简报、Google 账号最后 | 7 / 10 已上线 |
| [精简 Slim](https://github.com/ChisaAlter/ChisaBot/milestone/2) | P1–P5 收敛成私人助手（[docs/slimming.md](slimming.md)） | P1、P2、P3、P4a 已上线；P4b 在做 |
| [设备核心 Devices core](https://github.com/ChisaAlter/ChisaBot/milestone/3) | 设备上的编码工具、无界面节点、完全访问、本地 agent | 在做 |
| [成熟度 Maturity](https://github.com/ChisaAlter/ChisaBot/milestone/4) | 全量体验扫查 + 已知缺陷 / 性能尾巴 | 扫查在做 |
| [0.2.0 release](https://github.com/ChisaAlter/ChisaBot/milestone/5) | 下一次 PC + Android 发版，真机验证 | 待设备核心合并 |

## 现在（进行中）

| 条目 | 内容 | 里程碑 | 分支 |
|---|---|---|---|
| [CB-004](BACKLOG.md#cb-004) | 设备上的编码工具：云端机器人读 / 改 / 写本地代码（P0） | 设备核心 | `feat/devices-1` |
| [CB-005](BACKLOG.md#cb-005) | 无界面设备节点（Linux / macOS） | 设备核心 | `feat/devices-1` |
| [CB-006](BACKLOG.md#cb-006) | 设备「完全访问」模式 | 设备核心 | `feat/devices-1` |
| [CB-007](BACKLOG.md#cb-007) | 本地 agent 运行时与 agent 选择 | 设备核心 | `feat/local-agent-1` |
| [CB-008](BACKLOG.md#cb-008) | 本地 agent 沙箱 / 权限配置档 | 设备核心 | `feat/local-agent-1` |
| [CB-001](BACKLOG.md#cb-001) | 审批卡片与审批偏好 | Hark parity | `feat/approvals` |
| [CB-002](BACKLOG.md#cb-002) | 生图 / 识图模型设置，每人可覆盖 | Hark parity | `feat/model-media` |
| [CB-003](BACKLOG.md#cb-003) | 成熟度扫查（设备流程优先） | 成熟度 | `fix/maturity-1` |
| [CB-011](BACKLOG.md#cb-011) | 瘦身 P4b：不再构造上游服务端模块 | 精简 | — |
| [CB-012](BACKLOG.md#cb-012) | 项目维护与文档系统（本页） | 成熟度 | `chore/pm-system` |

## 接下来

| 条目 | 内容 | 为什么排在这 |
|---|---|---|
| [CB-030](BACKLOG.md#cb-030) | 设备「打开」能力可执行任意命令 | 完全访问上线前要先把能力边界理清 |
| [CB-018](BACKLOG.md#cb-018) | 用户电脑手动重装 PC 0.1.7 | 需要用户；设备核心验收依赖它 |
| [CB-017](BACKLOG.md#cb-017) | 真机验证 Windows / 安卓 | 需要用户；0.2.0 发版前 |
| [CB-019](BACKLOG.md#cb-019) | 发版 0.2.0 | 设备核心 + 审批合并之后 |
| [CB-021](BACKLOG.md#cb-021) | 一轮两张同一页面卡片 | 小缺陷 |
| [CB-023](BACKLOG.md#cb-023) | 后台任务卡片笼统文字 | 小缺陷 |
| [CB-027](BACKLOG.md#cb-027) | IM 定时推送的平台窗口 | 需要真实平台验证 |
| [CB-034](BACKLOG.md#cb-034) | 真实账号验证 GitHub / IM | 需要用户 |

## 以后

| 条目 | 内容 | 条件 |
|---|---|---|
| [CB-015](BACKLOG.md#cb-015) | 瘦身 P4c 合并重复系统 | 审批、设备核心合并之后 |
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
| 2026-10-15 | 瘦身 P3：删不发布的上游目录（约 10 万行）+ CI「ChisaBot checks」修绿 | #113 | [slimming.md](slimming.md) |
| 2026-10-15 | 瘦身 P4a：删前端死页（约 1.2 万行） | #116 | [slimming.md](slimming.md) · DESIGN §57 |
| 2026-10-15 | 瘦身 P2：示例部署包精简、开机清孤儿授权 / 包技能 / 包频道 | #110 | [slimming.md](slimming.md) |
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
