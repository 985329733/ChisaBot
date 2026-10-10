# ChisaBot PC（Windows 客户端）

架构与安全模型见 `../docs/pc-node.md`。

```sh
npm ci                 # 依赖（electron、electron-builder、ws）
npm test               # 节点核心与本机操作的单元测试（node:test，Linux 上也能跑）
npm start              # 本机运行 Electron
node src/cli.js run --server https://ayase.cn:8443 --token-file device.token   # 无界面节点
```

打包 Windows 安装包（NSIS 需要 x86_64 + wine，ARM 机器上用服务器的 electronuserland/builder:wine 容器）：

```sh
npx electron-builder --win nsis zip --x64 --publish never   # → dist/ChisaBot-PC-<版本>-x64-setup.exe / -portable.zip
```
