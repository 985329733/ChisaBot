#!/usr/bin/env node
"use strict";
/**
 * 无界面节点（Windows / Linux / macOS 都能跑），用于测试或服务器式部署。
 *
 *   node src/cli.js login  --server https://chisabot.example.com:8443 --user admin --token-file ./device.token
 *        （密码从环境变量 CHISABOT_PASSWORD 读取）
 *   node src/cli.js run    --server https://chisabot.example.com:8443 --token-file ./device.token [--approve deny|approve|web]
 *   node src/cli.js logout --server ... --token-file ...
 *
 * --approve：需要审批时的本机回答。web（默认）= 本机不回答，等网页 / 手机上审批。
 */
const fs = require("node:fs");
const os = require("node:os");
const { createNodeAgent } = require("./agent/core");
const { createOps } = require("./agent/ops");
const { attachAgentRuntime } = require("./agent-runtime/attach");
const auth = require("./agent/auth");
const pkg = require("../package.json");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function clientInfo() {
  return {
    clientVersion: `${pkg.version}-cli`,
    platform: process.platform,
    osVersion: `${os.type()} ${os.release()}`,
    hostname: os.hostname(),
    arch: os.arch(),
  };
}

async function main() {
  const command = process.argv[2];
  const server = arg("server");
  const tokenFile = arg("token-file", "./device.token");
  if (!server || !["login", "run", "logout"].includes(command)) {
    console.log("用法：node src/cli.js login|run|logout --server URL --token-file FILE");
    process.exit(2);
  }
  if (command === "login") {
    const session = await auth.login({ serverUrl: server, username: arg("user"), password: process.env.CHISABOT_PASSWORD });
    const result = await auth.enroll({ serverUrl: server, cookieHeader: session.cookieHeader, info: { ...clientInfo(), name: arg("name", os.hostname()) } });
    fs.writeFileSync(tokenFile, result.token, { mode: 0o600 });
    console.log(`已登记设备 ${result.device.id}「${result.device.name}」，令牌已写入 ${tokenFile}`);
    return;
  }
  const token = fs.readFileSync(tokenFile, "utf8").trim();
  if (command === "logout") {
    console.log((await auth.unenroll({ serverUrl: server, token })) ? "已退出并作废令牌" : "退出失败");
    return;
  }
  const approveMode = arg("approve", "web");
  // 本地 agent（Claude Code / Codex / 内置循环…，docs/local-agents.md）：同一条连接。
  const agentRuntime = attachAgentRuntime({ log: (line) => console.log(`[本地 agent] ${line}`) });
  const agent = createNodeAgent({
    onExtra: agentRuntime.onExtra,
    serverUrl: server,
    getToken: () => token,
    ops: createOps({ clientVersion: pkg.version }),
    clientInfo: clientInfo(),
    approve:
      approveMode === "web"
        ? undefined
        : async (req) => {
            console.log(`[审批] ${req.botName || "机器人"} 请求：${req.summary} → ${approveMode === "approve" ? "允许" : "拒绝"}`);
            return approveMode === "approve" ? "approve" : "deny";
          },
  });
  agentRuntime.bind(agent);
  agent.events.on("state", ({ state, detail }) => console.log(`[状态] ${state}${detail ? `（${detail}）` : ""}`));
  agent.events.on("config", (device) =>
    console.log(`[配置] ${device.name} paused=${device.paused} roots=${JSON.stringify(device.allowedRoots)} caps=${JSON.stringify(device.capabilities)}`),
  );
  agent.events.on("audit", (entry) => console.log(`[审计] ${entry.actor} ${entry.operation} ${entry.outcome} ${entry.summary || ""}${entry.detail ? ` — ${entry.detail}` : ""}`));
  agent.events.on("revoked", () => {
    console.log("[撤销] 设备已被撤销，退出。");
    process.exit(3);
  });
  agent.events.on("error", (error) => console.log(`[错误] ${error.message}`));
  agent.start();
  process.on("SIGINT", () => {
    agent.stop();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    agent.stop();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error(`失败：${error.message}`);
  process.exit(1);
});
