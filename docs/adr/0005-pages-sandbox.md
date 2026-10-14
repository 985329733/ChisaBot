# ADR-0005：页面放在同源 `/p/` 下，用 CSP sandbox 隔离

- 状态：已采纳
- 日期：2026-10-14
- 相关：DESIGN.md §54；docs/pages.md；网关 `location ^~ /p/`

## 背景

Hark parity 第 7 项：机器人做的单页网页要能发链接给别人看，不用登录。页面是模型写的 HTML + 脚本，不可信。

## 决定

- 地址 `/p/<16 位随机小写字母数字>/`，不列出；不存在 / 未发布 / 已删除都返回同一张「页面不存在」。
- `/p/` 下所有响应带 `Content-Security-Policy: sandbox …`（**没有** `allow-same-origin`）+ `connect-src 'none'` +
  `form-action 'none'`：脚本能跑，但源是 `null`，读不到 ChisaBot 的 Cookie / 存储，连不了接口，交不了表单。
- 网关对 `/p/` 只放 GET/HEAD、不转发 Cookie，允许跨站子资源 GET。
- 每次改动存一版（保留 50 版），恢复 = 复制成最新一版。

## 后果

- 不需要第二个域名就能安全托管不可信页面。
- 页面不能调用任何后端（包括 ChisaBot 自己的），要动态数据只能在生成时写进去。
- 网关不随一键更新，部署新网关模板时要带上 `/p/` 规则。
