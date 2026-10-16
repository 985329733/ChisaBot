# 简单回合不出干活卡 / 不画空气泡 / 答完下面不留空（DESIGN.md §93）

真浏览器 + 假模型，在一个**预览实例**上跑（建 1 个临时机器人，结束删掉；只放行建 / 删机器人和发消息，其余非 GET 一律拦掉；设备截图地址换成 `shot.png`）：

- `mock-model.mjs`：OpenAI 兼容假模型（端口 4011）。最后一条用户消息决定：
  - `LONG`：24 段的长回答（先把对话撑过一屏，量正常底边距）；
  - `QUIET`：开场一句 + 列设备 → 只读工具 → 「这是你当前在线的 … 屏幕：」+ 截图（用户那一轮的形状）；
  - `LOUD`：同样开场 + 4 个只读工具 → 同样的回答（超过 3 步，卡片保留）。
- `quiet.mjs`：实时有卡片；结束后没有卡片行、开场一句不露、0 个空气泡、截图在、最后一行下面 = 长回答之后的底边距（spacer 0 / slack 0）、结束时只往下平滑落；刷新后一样；LOUD 卡片保留、开场一句在点开的卡片里。

跑法（ChisaBot 镜像里，`--network host`）：

```
node tests/quiet-turn/mock-model.mjs &     # 假模型；把预览的默认模型指向 http://<host>:4011/v1，模型名 mockquiet
BASE=http://127.0.0.1:<预览端口> W=1280 H=860 THEME=light node tests/quiet-turn/quiet.mjs   # 失败退出码 1
# W=390 H=844 THEME=dark；ONLY=quiet / ONLY=loud；KEEP=1 不删临时机器人
```

旧镜像（§93 之前）上：结束后 spacer 262px（1280 宽）、刷新后 slack 446px，最后一行下面 286 / 470px。
