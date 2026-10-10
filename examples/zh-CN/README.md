# ChisaBot 中文租户包

此目录提供中文品牌、BOT、频道、技能与示例模型配置。从 `server/` 启动时，设置 `TENANT_PACKAGE_DIR=../examples/zh-CN`；前端配置生成和部署应使用同一个租户包。

`brand.yaml` 的 `product_name` 是展示名称。`tenant.id` 保留为 `openbot`，兼容已有数据和集成。

`model.yaml` 提供启动示例。实际协议、API 地址、密钥和部署默认模型可在管理页面配置；每个 BOT 的选择可从聊天输入框或 BOT 设置修改。接入 Magpie 后，模型列表来自网关向所配置调用密钥开放的目录。

不要将真实密钥、登录密码或私人服务器地址写入此目录。

参考：[快速开始](../../docs/getting-started.md) · [模型配置](../../docs/models.md) · [Magpie 集成](../../docs/magpie.md)
