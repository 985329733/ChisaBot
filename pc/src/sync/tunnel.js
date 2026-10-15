"use strict";
/**
 * 电脑文件夹同步的隧道（P4，docs/cloud-claude-code.md §5.4）：OpenSSH 的 ProxyCommand。
 *
 *   ProxyCommand "<node>" "<本文件>" --server https://… --workspace <工作区> --token-file <令牌文件>
 *
 * 先用设备令牌换一张一次性隧道票（60 秒，绑定设备 + 工作区 + 绑定代号），再开 WSS
 * /api/devices/agent/sync-tunnel?ticket=…，把 stdin/stdout 和这条 WSS 的二进制帧对接。
 * 服务器再让云端节点开一条回来的 WSS，连到节点旁边同步边车的 127.0.0.1:2222。主机上没有任何新端口。
 *
 * 令牌只从文件或环境变量 CHISABOT_DEVICE_TOKEN 读，不出现在命令行里。
 */
const fs = require("node:fs");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) out[a.slice(2)] = argv[i + 1], i++;
  }
  return out;
}

function base(serverUrl) {
  const u = new URL(serverUrl);
  return u.origin;
}

async function requestTicket({ server, token, workspaceId, fetchImpl = globalThis.fetch }) {
  const res = await fetchImpl(`${base(server)}/api/devices/agent/sync/ticket`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-Device-Token": token, Origin: base(server) },
    body: JSON.stringify({ workspaceId }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ticket) throw new Error(body.error || `拿不到隧道票（HTTP ${res.status}）`);
  return String(body.ticket);
}

function tunnelUrl(server, ticket) {
  const u = new URL(server);
  u.protocol = u.protocol === "http:" ? "ws:" : "wss:";
  u.pathname = "/api/devices/agent/sync-tunnel";
  u.search = new URLSearchParams({ ticket }).toString();
  u.hash = "";
  return u.toString();
}

/** 把一对流接到隧道上（stdin/stdout，或者测试里的流）。返回结束时 resolve 的 Promise。 */
async function pipeTunnel({ server, token, workspaceId, input, output, WebSocket, fetchImpl, log = () => {} }) {
  const ticket = await requestTicket({ server, token, workspaceId, fetchImpl });
  const WebSocketImpl = WebSocket || require("ws");
  const ws = new WebSocketImpl(tunnelUrl(server, ticket), {
    headers: { "X-Device-Token": token, Origin: base(server) },
    handshakeTimeout: 20_000,
    perMessageDeflate: false,
  });
  return await new Promise((resolve) => {
    let done = false;
    const finish = (code, why) => {
      if (done) return;
      done = true;
      if (why) log(why);
      try {
        ws.close();
      } catch {}
      resolve(code);
    };
    const queue = [];
    input.on("data", (chunk) => {
      if (ws.readyState === 1) ws.send(chunk, { binary: true });
      else queue.push(chunk);
    });
    input.on("end", () => finish(0));
    ws.on("open", () => {
      for (const c of queue.splice(0)) ws.send(c, { binary: true });
    });
    ws.on("message", (data) => {
      const ok = output.write(Buffer.isBuffer(data) ? data : Buffer.from(data));
      if (!ok && ws._socket) {
        ws._socket.pause();
        output.once("drain", () => ws._socket && ws._socket.resume());
      }
    });
    ws.on("unexpected-response", (_req, res) => finish(1, `隧道被拒绝（HTTP ${res.statusCode}）`));
    ws.on("close", () => finish(0));
    ws.on("error", (e) => finish(1, `隧道出错：${e.message}`));
  });
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const server = args.server || process.env.CHISABOT_SERVER;
  const workspaceId = args.workspace;
  let token = process.env.CHISABOT_DEVICE_TOKEN || "";
  if (!token && args["token-file"]) token = fs.readFileSync(args["token-file"], "utf8").trim();
  if (!token && args.config) token = JSON.parse(fs.readFileSync(args.config, "utf8")).token || "";
  if (!server || !workspaceId || !token) {
    process.stderr.write("用法：tunnel.js --server URL --workspace ID (--token-file F | --config config.json)\n");
    return 2;
  }
  return await pipeTunnel({ server, token, workspaceId, input: process.stdin, output: process.stdout, log: (s) => process.stderr.write(`chisabot-sync: ${s}\n`) });
}

if (require.main === module) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      process.stderr.write(`chisabot-sync: ${e.message}\n`);
      process.exit(1);
    },
  );
}

module.exports = { requestTicket, tunnelUrl, pipeTunnel, parseArgs, main };
