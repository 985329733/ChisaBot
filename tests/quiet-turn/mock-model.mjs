// OpenAI 兼容假模型（DESIGN §93 简单回合），端口 4011。最后一条用户消息决定：
//   QUIET -> 开场一句 + device_list → 只读工具 → 「这是你当前在线的 … 屏幕：」+ 截图（用户 18:39 那一轮的形状）
//   LOUD  -> 同样开场 + 4 个只读工具 → 结果（超过 3 步，卡片保留）
//   SHORT -> 直接回答（没有工具）
import http from "node:http";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const LEAD = "我来查看你当前在线电脑的屏幕；如果有多台在线，会先确认设备列表。";
const SHOT = "/api/devices/dev_quiettest/screenshots/4742d801-cbce-4ee5-842a-af7c7e03b153";
const ANSWER = `这是你当前在线的 **DESKTOP-ES2O7G4** 屏幕：\n\n![当前电脑截图](${SHOT})`;
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
  if (req.method === "GET") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ data: [{ id: "mockquiet", object: "model" }] })); }
  let j = {}; try { j = JSON.parse(body || "{}"); } catch {}
  const messages = j.messages || []; const user = lastUser(messages); const done = turnTools(messages);
  const tools = (j.tools || []).map((t) => t.function?.name).filter(Boolean);
  console.log(new Date().toISOString(), user.slice(0, 20), "done", done, "tools", tools.filter((t) => /^(device|memory|page|schedule)/.test(t)).join(","));
  const id = `chatcmpl-${Date.now()}`; const base = { id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: "mockquiet" };
  if (!j.stream) { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ id, object: "chat.completion", model: "mockquiet", choices: [{ index: 0, message: { role: "assistant", content: "测试标题" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })); }
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
  send({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] });
  const text = async (t, gap = 0, size = 1000) => {
    const a = Array.from(t);
    for (let i = 0; i < a.length; i += size) { send({ ...base, choices: [{ index: 0, delta: { content: a.slice(i, i + size).join("") }, finish_reason: null }] }); if (gap) await sleep(gap); }
  };
  const finish = () => { send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }); res.write("data: [DONE]\n\n"); res.end(); };
  const pick = (...names) => names.find((n) => tools.includes(n)) || names[names.length - 1];
  const call = (name, args = "{}") => {
    const cid = `call_${Date.now()}`;
    send({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: cid, type: "function", function: { name, arguments: "" } }] }, finish_reason: null }] });
    send({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: args } }] }, finish_reason: null }] });
    send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } });
    res.write("data: [DONE]\n\n"); res.end();
  };
  const READ = pick("page_list", "schedule_list", "memory_search");
  const readArgs = READ === "memory_search" ? JSON.stringify({ query: "电脑" }) : "{}";
  const LIST = pick("device_list", READ);
  if (/QUIET|LOUD/.test(user)) {
    const steps = /LOUD/.test(user) ? 4 : 2;
    if (done === 0) { await text(LEAD, 40, 3); await sleep(300); return call(LIST); }
    if (done < steps) { await sleep(900); return call(READ, readArgs); }
    await sleep(400); await text(ANSWER, 30, 4); return finish();
  }
  if (/LONG/.test(user)) { await text(Array.from({ length: 24 }, (_, i) => `第 ${i + 1} 段：这是一段比较长的测试回答，用来把对话撑过一屏。`).join("\n\n"), 0); return finish(); }
  await text("好的，收到。", 40, 2); return finish();
}).listen(4011, () => console.log("mockquiet on 4011"));
