# 聊天文件与图片生成（ChisaBot）

设计见 DESIGN.md「聊天文件与图片生成」一节。

- 机器人聊天里上传的文件（≤ 20 MB）存进库（按人隔离）并写进机器人工作区 `uploads/`；消息里是 `/api/chat-files/<id>`。
- 机器人用 `file_share` 把工作区文件交给用户（聊天里出可下载的文件卡，图片 / PDF 可预览）。
- 图片生成默认关闭；管理员在 设置 → 图片生成 选接口（MiniMax image-01，或 OpenAI 兼容 /v1/images），打开后机器人有 `image_generate` / `image_edit`。每张图按模型价格计费。

## 接口
- `POST /api/chat-files`（multipart：`file`、`agentId`）→ `{ file }`
- `GET /api/chat-files?agentId=&images=1&limit=` → `{ files }`
- `GET /api/chat-files/:id`（本人；`?download=1` 强制下载）、`DELETE /api/chat-files/:id`
- 管理员：`GET|PUT /api/chat-files/settings/image`、`POST /api/chat-files/settings/image/test`

## 环境变量
- `MINIMAX_API_KEY`：MiniMax 图片接口的密钥（设置页没填密钥时用）；`OPENAI_BASE_URL` 指向 minimax 时也会沿用 `OPENAI_API_KEY`。
- `IMAGE_API_KEY`：OpenAI 兼容图片接口的密钥（设置页没填时用）。
