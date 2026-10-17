// guard.mjs — 生产测试守则 helper (2026-10-15, after the agent_29339ac2 restore incident).
// Every prod/preview test script that deletes bots must go through this module.
//
//   import { guardInit, trackBot, guardedDeleteBot } from "./guard.mjs";
//   const call = (p, o) => api(page, p, o);          // any fn (path, opts) -> {status, body}
//   await guardInit(call);                            // snapshot the bots that exist BEFORE the run
//   const id = trackBot(JSON.parse(r.body).agent.id); // right after POST /api/agents
//   await guardedDeleteBot(call, id);                 // refuses anything not created by this run
//
// Rules enforced:
//   1. Never delete a bot that existed when the run started (snapshot from GET /api/agents).
//   2. Never delete a bot this process did not create (trackBot) — no deleting ids read from files.
//   3. Never delete a protected id (hard-coded user bots + env PROTECTED_BOTS, comma separated).
//   4. Never delete a bot whose createdAt is older than the run start (when the API reports it).
// A refused delete returns { status: 0, refused: true, reason } and logs "GUARD-REFUSED".

const RUN_START = Date.now();
const ID = /^agent_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PROTECTED = new Set([
  "agent_29339ac2-d45c-4826-b55d-6222fa59a958", // the user's 「通用助手」 (restored 2026-10-15)
  "general-assistant",
  "knowledge",
  ...String(process.env.PROTECTED_BOTS || "").split(",").map((s) => s.trim()).filter(Boolean),
]);
const preexisting = new Set();
const created = new Set();
let initialised = false;

function parse(body) {
  if (body && typeof body === "object") return body;
  try { return JSON.parse(body); } catch { return null; }
}
function collectIds(json, out = new Set()) {
  if (!json || typeof json !== "object") return out;
  if (Array.isArray(json)) { for (const v of json) collectIds(v, out); return out; }
  for (const [k, v] of Object.entries(json)) {
    if ((k === "id" || k === "agentId") && typeof v === "string" && (ID.test(v) || PROTECTED.has(v))) out.add(v);
    else if (v && typeof v === "object") collectIds(v, out);
  }
  return out;
}

export async function guardInit(call) {
  const r = await call("/api/agents", {});
  const json = parse(r.body);
  if (r.status >= 300 || !json) throw new Error(`GUARD: cannot snapshot bots (status ${r.status}) — refusing to run destructive steps`);
  for (const id of collectIds(json)) preexisting.add(id);
  initialised = true;
  console.log("GUARD-SNAPSHOT", preexisting.size, "pre-existing bots protected:", [...preexisting].join(","));
  return [...preexisting];
}

export function trackBot(id) {
  if (!ID.test(String(id))) throw new Error(`GUARD: trackBot got a non-bot id ${id}`);
  if (preexisting.has(id)) throw new Error(`GUARD: ${id} existed before this run; it is not ours`);
  created.add(id);
  return id;
}

export async function guardedDeleteBot(call, id) {
  let reason = null;
  if (!initialised) reason = "guardInit() was not called";
  else if (PROTECTED.has(id)) reason = "protected id";
  else if (preexisting.has(id)) reason = "bot existed before this run";
  else if (!created.has(id)) reason = "not created by this run (trackBot)";
  if (!reason) {
    const g = await call(`/api/agents/${id}`, {});
    const j = parse(g.body);
    const createdAt = j && (j.agent?.createdAt || j.createdAt || j.profile?.createdAt);
    if (createdAt && Date.parse(createdAt) < RUN_START - 120_000) reason = `createdAt ${createdAt} is older than the run`;
  }
  if (reason) {
    console.log("GUARD-REFUSED DELETE", id, reason);
    return { status: 0, refused: true, reason };
  }
  const r = await call(`/api/agents/${id}`, { method: "DELETE" });
  created.delete(id);
  return r;
}

export function guardState() {
  return { runStart: new Date(RUN_START).toISOString(), preexisting: [...preexisting], created: [...created] };
}
