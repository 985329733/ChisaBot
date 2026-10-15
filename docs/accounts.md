# 账号：目前只做单用户

2026-10-15 起 ChisaBot 只有一个账号：登录网关 `config.json` 里的管理员（应用里是 `dev-local-user`）。朋友账号 / 邀请链接（#128，CB-040）
已按用户决定去掉，见 [ADR-0012](adr/0012-single-user-for-now.md)、DESIGN.md §65。

## 部署方

- 登录服务 `deploy/public/auth/server.ts`：只认 `config.json` 的 `username` + `passwordHash`（账号名不分大小写）；手机扫码会话只给管理员名下的手机。
- 可选的签名身份：`config.json` 填 `identitySecret`（≥32 字符），应用 `.env` 填同值的 `CHISABOT_GATEWAY_SECRET`，nginx 模板把
  `X-ChisaBot-Identity` 转给应用。不配也能用（和更早的单账号一样）。
- 升级已开过多账号的网关：换上新的 `server.ts` + `auth-web/login.*`，重启登录服务即可；`accounts` / `invites` 表不删，旧的朋友会话启动时被清掉，管理员会话不受影响。
