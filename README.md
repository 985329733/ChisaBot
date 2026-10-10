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

## 目录

| 路径 | 内容 |
| --- | --- |
| `app/` | 中文 Web 界面 |
| `server/` | API、本地运行、模型配置、BOT 与工具权限 |
| `shared/` | 前后端共享类型与协议 |
| `examples/zh-CN/` | 中文品牌、BOT、频道和技能配置 |
| `deploy/` | 自托管部署与认证网关 |
| `desktop/`、`mobile/` | 继承上游的桌面和移动客户端源码 |
| `docs/` | 中文使用指南、模型集成与上游技术参考 |

上游 Intelligence、第三方连接器与发布流程按需使用。桌面和移动源码保留上游的安装、OAuth 和发布集成，分发前需按自己的环境配置并构建；本仓库不表示已有 ChisaBot 公共镜像或安装器。

## 来源与许可证

- 上游项目：[CopilotKit/OpenBot](https://github.com/CopilotKit/OpenBot)
- 交互协议：[AG-UI](https://github.com/ag-ui-protocol/ag-ui)
- 模型网关：[yetone/magpie](https://github.com/yetone/magpie)

代码继续使用 [MIT License](LICENSE)，保留上游 `Copyright (c) 2026 CopilotKit` 及原有许可声明。ChisaBot 是在上游基础上定制的分支。
