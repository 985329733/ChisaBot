// OpenAI 兼容假模型（DESIGN §90 过程话收进干活卡 / liveTail 不重复），端口 4011。最后一条用户消息决定：
//   FOLDOK  -> 开场一句 + 工具 → 过程话 + 工具 → 结果（结果是气泡）
//   FOLDERR -> 开场一句 + 工具 → 过程话 + 工具 → 过程话 + 工具（参数写到一半连接断开 = 这一轮出错）
//   DUP     -> 开场一句慢慢流 ~12 秒 + 工具 → 结果（测试在流的时候断网再连上）
import http from "node:http";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const NARR = "检查结果显示两项都未安装，我先用第一个办法装，完成后再装你指定的包。";
export const NARR2 = "第二步还没成功，我换个办法重新安装。";
function lastUser(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user") return typeof m.content === "string" ? m.content : (m.content || []).map((p) => p.text || "").join("");
  }
  return "";
}
function turnTools(messages) {
  let n = 0;
  for (let i = messages.length - 1; i >= 0 && messages[i].role !== "user"; i--) if (messages[i].role === "tool") n++;
  return n;
}
http.createServer(async (req, res) => {
  let body = ""; for await (const c of req) body += c;
  if (req.method === "GET") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ data: [{ id: "mockfold", object: "model" }] })); }
  let j = {}; try { j = JSON.parse(body || "{}"); } catch {}
  const messages = j.messages || []; const user = lastUser(messages); const done = turnTools(messages);
  const tools = (j.tools || []).map((t) => t.function?.name).filter(Boolean);
  console.log(new Date().toISOString(), user.slice(0, 20), "done", done, "tools", tools.length);
  const id = `chatcmpl-${Date.now()}`; const base = { id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: "mockfold" };
  if (!j.stream) { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ id, object: "chat.completion", model: "mockfold", choices: [{ index: 0, message: { role: "assistant", content: "测试标题" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })); }
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
  send({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] });
  const text = async (t, gap = 0, size = 1000) => {
    const a = Array.from(t);
    for (let i = 0; i < a.length; i += size) { send({ ...base, choices: [{ index: 0, delta: { content: a.slice(i, i + size).join("") }, finish_reason: null }] }); if (gap) await sleep(gap); }
  };
  const finish = () => { send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }); res.write("data: [DONE]\n\n"); res.end(); };
  const pick = (...names) => names.find((n) => tools.includes(n)) || names[names.length - 1];
  const READ = pick("memory_search", "page_list", "schedule_list", "web_search");
  const call = (q) => {
    const args = READ === "memory_search" || READ === "web_search" ? JSON.stringify({ query: q }) : "{}";
    const cid = `call_${Date.now()}`;
    send({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: cid, type: "function", function: { name: READ, arguments: "" } }] }, finish_reason: null }] });
    send({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: args } }] }, finish_reason: null }] });
    send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } });
    res.write("data: [DONE]\n\n"); res.end();
  };
  if (/FOLDOK|FOLDERR/.test(user)) {
    if (done === 0) { await text("我先检查一下。", 60, 2); await sleep(300); return call("检查"); }
    if (done === 1) { await sleep(500); await text(NARR, 40, 3); await sleep(400); return call("安装"); }
    if (/FOLDERR/.test(user)) {
      // 过程话 → 开始调工具（参数写到一半）→ 连接断开：这一轮出错，工具没有结果（截图那一轮）
      await sleep(500); await text(NARR2, 40, 3); await sleep(300);
      send({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: `call_${Date.now()}`, type: "function", function: { name: READ, arguments: "" } }] }, finish_reason: null }] });
      send({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"query":"重' } }] }, finish_reason: null }] });
      await sleep(300); res.destroy(); return;
    }
    await sleep(500); await text("装好了，两项都可以用了。", 40, 3); return finish();
  }
  if (/DUP/.test(user)) {
    if (done === 0) { await text("刚才安装调用中断了，我先确认是否已经装好。这一段会慢慢写出来，好让测试在中途断网再连上。", 280, 1); await sleep(300); return call("确认"); }
    await sleep(800); await text("确认过了，已经装好。", 60, 2); return finish();
  }
  await text("好的。"); finish();
}).listen(4011, () => console.log("mockfold on 4011"));
