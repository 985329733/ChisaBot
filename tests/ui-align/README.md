# UI 文字对齐 / 间距回归（DESIGN.md §82）

真浏览器里量每个页面上的控件（按钮、胶囊、标签、分段、下拉、输入框、徽标、提示），1280 浅色 + 390 深色：

- `measure.js`（注入页面）：
  - **V** 文字框中心 vs 控件内容框中心，竖向偏 > 1px（只量有底色 / 描边 / 阴影的控件）；
  - **H** 本该居中的控件（`justify-content:center` / `text-align:center`）里内容横向偏 > 2px；
  - **INK** 中文字形墨迹中心（canvas `measureText` 的实际上下沿）vs 控件外框中心偏 > 1.5px；
  - **ICON** 图标和同一行文字不在一条线上（中文 > 1.5px，拉丁 > 2.5px）；
  - **CLIP** 文字超出控件且没有省略号；**WRAP** 短标签（≤ 24 字）被折成多行；
  - **ROWH** 同一横排里带字的按钮高度不一；
  - **TIGHT** 有框的按钮和正上 / 正下方的文字隔不到 4px；
  - **GAP** 干活卡 / 收成的「✓ …」行和上下内容隔不到 6px（进行中每 350ms 采样一次，结束、展开各量一次）。
- `align.mjs`：逐页打开、量、截图（红框 = V/H/CLIP/WRAP/ROWH/TIGHT/PIX，黄框 = INK，紫框 = GAP），
  每个单行控件再截一张 2 倍图做 **PIX_V / PIX_H**（像素墨迹：字 + 图标真画出来的部分，竖 > 1px / 横 > 2px）。
  输出 `$OUT/results.json`（每页 counts / flags / 干活卡间距）+ 截图 + 被标控件的放大图。
  所有非 GET 请求一律拦掉；`CHAT=1` 时只放行建临时机器人和发消息（只删这次自己建的机器人）。

跑法（在 ChisaBot 镜像里，`--network host`，预览实例）：

```
# 只读：页面 + 菜单 + 弹窗
BASE=http://127.0.0.1:<预览端口> OUT=/out/align node tests/ui-align/align.mjs
# 带聊天（干活卡间距）：先起假模型，把预览的默认模型指向它
node tests/ui-align/mock-model.mjs &   # 端口 4011；提示 WORK / CARD
CHAT=1 BASE=… node tests/ui-align/align.mjs
# 回归门槛：有任何标记就退出码 1
FAIL_ON=1 CHAT=1 BASE=… node tests/ui-align/align.mjs
```

挂上 Noto Sans CJK SC（安卓 / 多数 Linux 的中文字体）再跑一遍：镜像里默认只有文泉驿正黑，两种字体的上下沿不一样。
`app/tests/ui-align.test.ts` 是 CI 里的静态护栏（锁住 §82 的几个根因）。
