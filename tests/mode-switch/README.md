# 机器人 ↔ Claude Code 切换回归（DESIGN.md §84）

`mode-switch.mjs` 以管理员身份打开一个机器人的对话，在 1280 亮 / 1280 暗 / 390 亮 / 390 暗下用左栏「机器人｜Claude Code」来回切 3 次，每次切换逐帧（requestAnimationFrame）取样，判定：

- 0 次文档导航（不是整页刷新）；
- 外壳 `.glass-shell`、顶栏、左栏容器（桌面）还是原来那个元素，机器人那块左栏内容没有重挂；
- 0 帧整屏骨架 / 外壳缺席，主区 0 帧空白；
- 切回机器人回到原来那条对话。

只读：所有非 GET 请求都被拦下。

```sh
# 预览（dev 免登录，管理员）
BASE=http://127.0.0.1:3211 node tests/mode-switch/mode-switch.mjs
# 生产只读（临时登录 cookie）
BASE=https://ayase.cn:8443 TOK=<session> node tests/mode-switch/mode-switch.mjs
# 对照修复前的版本：只记录不判定
EXPECT=0 BASE=… node tests/mode-switch/mode-switch.mjs
```

需要 `playwright-core` 和 Chromium（应用镜像里的 `/ms-playwright`，或 `CHROME=`）。截图和 `result.json` 在 `$OUT_DIR/mode-switch-<TAG>/`。
