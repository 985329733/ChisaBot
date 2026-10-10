# ChisaBot PC（Windows 客户端）

架构与安全模型见 `../docs/pc-node.md`（§8 是客户端），界面规范见 `../DESIGN.md` §16。

- 主窗口就是服务器上的 ChisaBot 网页本身（同一套聊天 / 偏好设置 / 管理后台布局）；本机设置是网页的
  偏好设置 → 设备 → 这台电脑（「本机」标签），通过 `src/web-preload.js` 的本机桥做网页做不到的事。
- 原生窗口（设置向导、审批弹窗、本机确认、离线页）在 `src/ui/`，令牌和天空由
  `node scripts/sync-skyglass.mjs` 从 `../app/src/styles.css`、`../app/src/lib/sky.ts` 生成（网页改了令牌就重跑）。

```sh
npm ci                 # 依赖（electron、electron-builder、ws）
npm test               # 节点核心与本机操作的单元测试（node:test，Linux 上也能跑）
npm start              # 本机运行 Electron
node src/cli.js run --server https://ayase.cn:8443 --token-file device.token   # 无界面节点
```

打包 Windows 安装包（NSIS 需要 x86_64 + wine，ARM 机器上用服务器的 electronuserland/builder:wine 容器，
见服务器 `/opt/chisabot-pc-build/build.sh` 与 `publish-pc.sh`）：

```sh
npx electron-builder --win nsis zip --x64 --publish never   # → dist/ChisaBot-PC-<版本>-x64-setup.exe / -portable.zip
```
