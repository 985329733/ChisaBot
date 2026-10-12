# 管理员自检（不碰任何对话）

发布、一键更新之后要确认「这台服务器此刻能跟模型说上话」。以前的做法是在某个机器人的对话里真的发一句「ok」，
消息就永远留在用户的对话里。**从现在起所有自检都走这里，不再往真实对话里发消息。**

## 接口：`POST /api/admin/smoke`

- 仅管理员（`requireAdmin`），响应 `Cache-Control: no-store`。代码：`server/src/admin-smoke.ts`，测试：
  `server/tests/admin-smoke.test.ts`。
- 请求体可选：`{ "agentId": "<机器人 id>" }`。不给时用部署默认的模型连接；给了时走这个机器人自己的模型覆盖
  （和它聊天时完全一样的 `resolveRuntimeConnectionForAgent`）。
- 做的事：生成随机口令 `CHISA-xxxxxxxx`，让模型「只回复这个口令」；用和聊天**同一个** AI SDK 客户端
  （`connectionLanguageModel`，同样的接口地址、密钥、`useApiKey`、不跟随重定向）非流式请求一次，45 秒超时。
  回复里有口令才算通过。
- **不落库**：不建频道、不写消息、不写记忆、不写审计行、不触发投递。响应里固定 `persisted: false`。
  服务器日志只有一行 `[admin-smoke] ok=… model=… agent=… <毫秒>ms`，口令、回复、密钥都不进日志。
- 响应：

  ```json
  { "ok": true, "persisted": false, "provider": "openai", "model": "…", "agentId": null,
    "latencyMs": 1234, "echoed": true, "reply": "CHISA-1A2B3C4D", "message": "自检通过：模型按要求回复了口令。" }
  ```

  通过是 200；模型没回口令、空回复、超时、连接或密钥失败是 502（同样的结构，`message` 说原因，不含秘密）；
  读不到模型配置 503；非管理员 403；`agentId` 格式不对 400。

## 三种用法

1. **网页**：管理后台 → 系统更新 → 「自检」一栏的「自检」按钮，结果显示在按钮左边（模型、耗时、「未保存任何对话」）。
2. **服务器上（发布脚本 / Hark 用这个）**：本机 `127.0.0.1:3001` 的开发用户就是管理员，直接：

   ```sh
   curl -s -X POST -H 'content-type: application/json' -d '{}' http://127.0.0.1:3001/api/admin/smoke
   ```

   或者 `sh /opt/chisabot-updater/smoke.sh [机器人 id]`（`deploy/updater/smoke.sh`，打印结果，失败时退出码非 0）。
3. **经公网**：带管理员会话的 `POST https://<你的域名>:<端口>/api/admin/smoke`（网关先认证会话）。

## 它不覆盖什么

只验证「模型连接 + 聊天用的模型解析」。它不跑完整的机器人回合（系统提示、工具、CopilotKit 运行时、消息存储）。
要验证界面上的聊天流程，用 Playwright 在测试里拦截写请求（DESIGN.md / 项目 skill 里的做法），不要往真实对话发消息。
