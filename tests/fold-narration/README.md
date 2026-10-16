# 过程话收进干活卡 / 断线重接不写两遍（DESIGN.md §90）

真浏览器 + 假模型，在一个**预览实例**上跑（会建 3 个临时机器人，结束删掉；只放行建 / 删机器人和发消息，其余非 GET 一律拦掉）：

- `mock-model.mjs`：OpenAI 兼容假模型（端口 4011）。最后一条用户消息决定：
  - `FOLDOK`：开场一句 + 工具 → 过程话 + 工具 → 结果；
  - `FOLDERR`：开场一句 + 工具 → 过程话 + 工具 → 过程话 + 工具参数写到一半连接断开（这一轮出错，工具被中断）；
  - `DUP`：开场一句慢慢写 ~12 秒 + 工具 → 结果。
- `fold.mjs`：
  - FOLDOK：结束后卡片下面没有淡色过程话，结果是气泡，点开卡片能看到过程话；
  - FOLDERR：卡片下面没有散着的过程话，点开卡片能看到；刷新（回放）后一样；
  - DUP：写到一半把**本机**的事件流掐断（包一层 `fetch`，服务器接着跑）→ 出现「暂时连不上模型服务」→ 同步把这一轮重新接上（liveTail 回放）；开场一句只出现一次、服务器后来写完的结果也到了。

跑法（ChisaBot 镜像里，`--network host`）：

```
node tests/fold-narration/mock-model.mjs &      # 假模型；把预览的默认模型指向 http://<host>:4011/v1，模型名 mockfold
BASE=http://127.0.0.1:<预览端口> OUT=/tmp/fold node tests/fold-narration/fold.mjs   # 失败退出码 1
# ONLY=fold / ONLY=dup 只跑一部分；KEEP=1 不删临时机器人（查数据库用）
```

旧镜像（§90 之前）上：FOLDOK / FOLDERR 的过程话散在卡片外、卡片里没有；DUP 复现开场一句出现两遍。
