"use strict";
/**
 * 把 Claude Code `--output-format stream-json --verbose --include-partial-messages` 的一行一行，
 * 变成 ChisaBot 自己的小事件（服务器再拼成会话记录和流式气泡）：
 *   { kind: "init", sessionId, model }
 *   { kind: "text_start" }                       新的一段文字开始
 *   { kind: "text_delta", text }                 流式增量
 *   { kind: "text", text }                       一段文字的完整内容（以它为准，覆盖增量拼出来的）
 *   { kind: "tool_use", id, name, input }
 *   { kind: "tool_result", id, isError, content }
 *   { kind: "result", ok, text, costUsd, turns, sessionId, error }
 * 认不出的行忽略（CLI 升级加了新事件也不会坏）。
 */

const CONTENT_CAP = 4000;

function clip(value, cap = CONTENT_CAP) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) return "";
  return text.length > cap ? `${text.slice(0, cap)}…（已截断）` : text;
}

function resultText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c) => (c && c.type === "text" ? c.text : c && c.type ? `[${c.type}]` : "")).join("\n");
  return content == null ? "" : JSON.stringify(content);
}

/** 工具输入只留展示要用的部分（大块内容截断，避免一次 Write 把几百 KB 塞进会话记录）。 */
function slimInput(input) {
  if (!input || typeof input !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === "string") out[k] = v.length > 1200 ? `${v.slice(0, 1200)}…（${v.length} 字）` : v;
    else if (Array.isArray(v)) out[k] = v.length > 20 ? `[${v.length} 项]` : v;
    else out[k] = v;
  }
  return out;
}

function parseLine(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed.startsWith("{")) return [];
  let j;
  try {
    j = JSON.parse(trimmed);
  } catch {
    return [];
  }
  const events = [];
  if (j.type === "system" && j.subtype === "init") {
    events.push({ kind: "init", sessionId: j.session_id || null, model: j.model || null });
  } else if (j.type === "stream_event" && j.event) {
    const e = j.event;
    if (e.type === "content_block_start" && e.content_block && e.content_block.type === "text") events.push({ kind: "text_start" });
    else if (e.type === "content_block_delta" && e.delta && e.delta.type === "text_delta" && e.delta.text) events.push({ kind: "text_delta", text: e.delta.text });
  } else if (j.type === "assistant" && j.message && Array.isArray(j.message.content)) {
    for (const c of j.message.content) {
      if (c.type === "text" && c.text) events.push({ kind: "text", text: c.text });
      else if (c.type === "tool_use") events.push({ kind: "tool_use", id: c.id || null, name: c.name || "工具", input: slimInput(c.input) });
    }
  } else if (j.type === "user" && j.message && Array.isArray(j.message.content)) {
    for (const c of j.message.content) {
      if (c.type === "tool_result") events.push({ kind: "tool_result", id: c.tool_use_id || null, isError: !!c.is_error, content: clip(resultText(c.content), 1500) });
    }
  } else if (j.type === "result") {
    const ok = j.subtype === "success" && !j.is_error;
    events.push({
      kind: "result",
      ok,
      text: typeof j.result === "string" ? clip(j.result, 20000) : "",
      costUsd: typeof j.total_cost_usd === "number" ? j.total_cost_usd : null,
      turns: typeof j.num_turns === "number" ? j.num_turns : null,
      sessionId: j.session_id || null,
      error: ok ? null : clip(j.result || j.error || j.subtype || "Claude Code 出错", 1000),
    });
  }
  return events;
}

module.exports = { parseLine, slimInput, clip };
