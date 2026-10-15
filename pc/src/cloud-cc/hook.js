"use strict";
/**
 * `chisabot-node cc-hook`：Claude Code 的 PreToolUse 钩子（docs/cloud-claude-code.md §3.3）。
 * 从标准输入读 Claude 给的 JSON，经本机 unix socket 问节点主进程，按回答输出 hookSpecificOutput。
 * 问不到（主进程不在、超时）一律拒绝——宁可停下，也不放行。
 */
const net = require("node:net");

function answer(decision, reason) {
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision, permissionDecisionReason: reason } }) + "\n",
  );
}

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => {
      data += c;
      if (data.length > 4_000_000) data = data.slice(0, 4_000_000);
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
  });
}

async function runHook() {
  const sock = process.env.CHISABOT_CC_SOCK;
  const turnId = process.env.CHISABOT_CC_TURN;
  let input = {};
  try {
    input = JSON.parse((await readStdin()) || "{}");
  } catch {
    answer("deny", "钩子读不懂 Claude 给的输入");
    return 0;
  }
  if (!sock || !turnId) {
    answer("deny", "不在 ChisaBot 云端工作区里运行");
    return 0;
  }
  const query = { turnId, tool: input.tool_name, input: input.tool_input || {}, cwd: input.cwd || process.cwd() };
  const reply = await new Promise((resolve) => {
    let buf = "";
    const socket = net.createConnection(sock);
    const timer = setTimeout(() => {
      socket.destroy();
      resolve({ decision: "deny", reason: "等待批准超时" });
    }, 170_000);
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(JSON.stringify(query) + "\n"));
    socket.on("data", (c) => {
      buf += c;
    });
    socket.on("end", () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(buf.trim().split("\n")[0]));
      } catch {
        resolve({ decision: "deny", reason: "节点回答格式不对" });
      }
    });
    socket.on("error", () => {
      clearTimeout(timer);
      resolve({ decision: "deny", reason: "连不上 ChisaBot 节点" });
    });
  });
  const decision = reply.decision === "allow" ? "allow" : "deny";
  answer(decision, String(reply.reason || (decision === "allow" ? "已允许" : "已拒绝")));
  return 0;
}

module.exports = { runHook };
