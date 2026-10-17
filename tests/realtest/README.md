# 真实任务验收（DESIGN.md §101）

像用户一样用**真实网页界面**让机器人做事：有界面的 Chrome（Xvfb）打开聊天页，在输入框里逐字输入、回车，等这一轮结束，
截图、记下工具调用和回复。用真模型，所以只在需要验证「机器人真的能把事办成」时跑。

- `rt.mjs`：一次性机器人（`guard.mjs` 建 / 删，只删自己建的），同一段对话里按 `TASKS` 依次发任务：
  `a` 今日新闻 + 来源链接 · `b` 右栏浏览器读 GitHub 仓库信息 · `c1` httpbin 表单提交 · `c2` 带原生下拉框和日期的表单 · `c3` Hark 登录页下拉框 ·
  `d` 工作区建 / 改文件 · `e` 写并运行 Python · `f` 搜索→打开→表格 · `g1` 2 分钟提醒（等它到点） · `g2` 记忆 · `g3` 技能 · `g4` 做网页并发布 · `h` 多仓库调研（长任务，每 45 秒截一张进度）。
- `xbot.mjs`：两个一次性机器人，甲的一轮还在跑时在侧栏切到乙并让乙也开浏览器（§101.1）；结果里 `crossed` 为空、两边都有最终回答才算过。
  打串没打串最终以服务器 / 网关日志里 `POST /api/computers/<机器人>/navigate` 的机器人 id 为准。
- `sched.mjs`：定时任务完整流程（§101.3）：让机器人建一个 3 分钟后执行的任务 → 离开聊天 → 到点后台执行，点「发送」前放确认卡片 →
  回到聊天点「确认」→ 机器人自动接着做完。需要 `SEND_URL`：一个只有输入框和「发送」按钮的测试页（云端浏览器能打开的地址）。
- `MODEL=<模型 id>`（rt / sched）：把一次性机器人设成这个模型（例如强制用备用模型跑一遍）。
- 每个任务的结果里有 `finalOk`（最后一次工具结果之后有文字回答）、`blocked`（对话里出现「[blocked]」的次数）、`linkChecks`（工作区文件链接逐个下载的状态码）。
- 途中出现确认卡片时像用户一样点「确认」（只点文字恰好是「确认 / 批准 / 允许」的按钮；「我已自己完成」这类要人亲自做的不点）。
- `PC=1`：模拟 PC 客户端加载服务器网页（Electron UA、1280×840、注入 `window.chisabotWindow`）。
- 输出（`/out`）：每个任务 `<id>.png` / `<id>-full.png` / `<id>.txt`（工具调用 + 回复 + 对话末尾文字）、`results.json`、`run.log`。

运行（在服务器上，用应用镜像，自带 playwright-core 和 Chromium）：

```sh
docker run --rm --network host -e BASE=https://<你的域名> -e TOK=<临时会话> -e TASKS=a,b,c1 \
  -v $PWD/tests/realtest:/app/t -v $PWD/out:/out --entrypoint sh <应用镜像> \
  -c 'Xvfb :$((RANDOM%400+100)) -screen 0 1920x1080x24 & sleep 1; DISPLAY=… node /app/t/rt.mjs'
```

注意：多个同时跑的容器用 `--network host` 时 X 显示号会冲突（抽象 unix socket 按网络命名空间共享），每个容器用不同的显示号。
临时会话只给内置管理员签、跑完删除；不碰任何已有机器人和对话（生产测试守则见 docs/release.md §4）。
