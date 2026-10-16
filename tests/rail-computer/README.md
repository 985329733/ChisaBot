# 右栏「面板 | 计算机」入口回归（DESIGN.md §23 / §79）

`rail-computer.mjs` 打开一个机器人的空聊天（`/channel/new?agent=…&topic=new`）和它已有的一条对话，在 1280 亮 / 1280 暗 / 390 暗 / 390 亮下检查：

- 右栏（窄屏是点「面板」把手拉出的抽屉）有「面板」和「计算机」两个入口；
- 点「计算机」地址带 `watch=true`、标签选中；点「面板」切回。

只读：所有非 GET 请求都被拦下，不会发消息、不会改数据。

```sh
# 预览（dev 免登录）
BASE=http://127.0.0.1:3193 node tests/rail-computer/rail-computer.mjs
# 生产只读（带一个临时登录 cookie）
BASE=https://ayase.cn:8443 TOK=<session> node tests/rail-computer/rail-computer.mjs
```

需要 `playwright-core` 和 Chromium（应用镜像里的 `/ms-playwright` 即可，或用 `CHROME=` 指定）。截图在 `$OUT_DIR/rail-computer-<TAG>/`，退出码非 0 = 有入口不见了。
