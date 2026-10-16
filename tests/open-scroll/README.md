# 打开对话 / 切机器人（DESIGN.md §82）

`open-scroll.mjs`：真浏览器回归。打开很长的对话第一帧就在最新一条、不跳；切机器人再切回来秒开、不跳；
接入回放不超过预算；切回看过的对话不重复整段读取。

```sh
# 预览（生产库拷贝，左栏至少两个机器人、一个很长的对话）
BASE=http://127.0.0.1:3201 node tests/open-scroll/open-scroll.mjs
# 模拟慢网 + 慢手机（历史一段段到，最容易停在半截）
BASE=http://127.0.0.1:3201 THROTTLE=150:4000:4 node tests/open-scroll/open-scroll.mjs
```

只读：除接入（`POST …/connect`，不写东西）以外的非 GET 请求都在浏览器里拦下。退出码 0 = 全过，1 = 有失败，2 = 数据不够（跳过）。
可调：`WIDTHS`（默认 `1280,390`）、`SWITCH_BUDGET_MS`（默认 400，节流时 1200）、`CONNECT_BUDGET_KB`（默认 1024）。
