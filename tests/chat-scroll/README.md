# 聊天滚动回归（DESIGN.md §35）

真浏览器里复现「AI 输出时跳到上面的聊天记录」：假模型按上游的节奏（每 150ms 一批）流式吐长回复，逐帧记录
滚动容器的 scrollTop / scrollHeight / 视口里最早可见的那条消息。

- `mock-model.mjs`：OpenAI 兼容的假模型（`node mock-model.mjs`，端口 4010）。最后一条用户消息是 `SEED n`
  回短回复（用来攒历史），`LONG` 回带标题 / 列表 / 代码 / 表格 / 链接 / 图片的长回复（约 15 秒），`TOOLS`
  先说一句过程话再调一个工具。
- `repro.mjs`（playwright-core，Chromium 路径按 ChisaBot 镜像里的 `/ms-playwright`）：
  1. 在一个独立的预览实例里把默认模型指向假模型（`PUT /api/admin/model-settings`，provider `openai`，
     baseUrl `http://<mock>:4010/v1`），建一个测试机器人，`BOT=<id>`。
  2. `PHASE=seed N=30` 攒 60 条历史（> 50 条，CopilotKit 自带列表在这个长度会虚拟化），把会话存到 `/out/state.json`。
  3. `PHASE=stream PROMPT=LONG STATE=…/state.json`，可加 `MOBILE=1`（390×844）、`SCROLLUP=1`（输出中途往上滚 600px）、
     `CPU=4`、`VIDEO=1`。
- 判定：`HISTORY.framesShowingOlderHistory` 必须是 0（贴底时视口里从不出现比发送时更早的消息）；
  `SCROLLUP=1` 时 `yankedDown` 必须是 false、结束时仍停在用户滚到的位置。

修复前（虚拟化列表）：发送那一帧 scrollHeight +2958px，视口从第 63 条退到第 61 条再回弹。
