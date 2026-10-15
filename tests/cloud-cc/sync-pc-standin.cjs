"use strict";
/**
 * 电脑文件夹同步（P4b）的 Linux 电脑替身：和 PC 客户端用同一份同步管理（pc/src/sync/manager.js），
 * 只把平台相关的东西换成 Linux 的（自编译的 mutagen-linux-amd64、系统 OpenSSH、Node 跑 tunnel.js）。
 * 设备 WSS（core.js）照常连上，所以服务器发来的交接消息 sync_begin / sync_end 走的是真实路径。
 *
 *   SERVER=http://… TOKEN_FILE=/cc/ptok DATA=/pc/data PC=/pc/src MUTAGEN=/usr/local/bin/mutagen node sync-pc-standin.cjs
 *
 * 本机 127.0.0.1:7788 开一个控制口给 e2e 脚本：GET /status、POST /create|/enable|/release|/now|/resolve（JSON）、POST /quit。
 */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PC = process.env.PC || "/pc/src";
const { createSyncManager } = require(path.join(PC, "sync", "manager.js"));
const { createNodeAgent } = require(path.join(PC, "agent", "core.js"));

const server = process.env.SERVER;
const token = fs.readFileSync(process.env.TOKEN_FILE || "/cc/ptok", "utf8").trim();
const log = (s) => console.log(new Date().toISOString(), "[pc]", s);

// e2e 钩子：/tmp/kill-after-ready 存在时，交接 ② 回完 ready 立刻 SIGKILL（测「交接中途被杀，重启后按记录恢复」）
const fetchImpl = async (url, init) => {
  const res = await fetch(url, init);
  if (String(url).endsWith("/sync/handoff") && init && /"step":"ready"/.test(String(init.body)) && fs.existsSync("/tmp/kill-after-ready")) {
    fs.rmSync("/tmp/kill-after-ready", { force: true });
    log("e2e：回完 ready 就被杀");
    setTimeout(() => process.kill(process.pid, "SIGKILL"), 20);
  }
  return res;
};

const manager = createSyncManager({
  fetchImpl,
  dataDir: process.env.DATA || "/pc/data",
  serverUrl: () => server,
  getToken: () => token,
  mutagenPath: process.env.MUTAGEN || "/usr/local/bin/mutagen",
  sshPath: process.env.SSH || "/usr/bin/ssh",
  nodeExe: process.execPath,
  tunnelScript: path.join(PC, "sync", "tunnel.js"),
  // PROXY_EXE=编译好的 pc/sync-shim（Linux 版）：ProxyCommand 用 Go 包装器的 --chisabot-proxy（Windows 上的那条路）
  proxyExe: process.env.PROXY_EXE || undefined,
  platform: "linux",
  deviceLabel: "pc-standin",
  log,
  audit: (e) => log(`[审计] ${e.operation} ${e.outcome} ${e.summary || ""}`),
});

const ops = { stopAll: () => {}, run: async () => ({ ok: false, error: "替身不执行操作" }) };
const agent = createNodeAgent({
  onExtra: (m) => {
    if (manager.onServerMessage(m)) log(`收到 ${m.type} ${m.handoffId || ""}`);
  },
  serverUrl: server,
  getToken: () => token,
  ops,
  clientInfo: { name: "测试电脑（会删除）", platform: "win32", osVersion: "standin", hostname: "pc-standin", arch: "x64", clientVersion: "0.1.11" },
  allowFullAccess: false,
  unrefTimers: false,
});
agent.events.on("state", ({ state, detail }) => log(`设备连接 ${state}${detail ? ` ${detail}` : ""}`));
agent.events.on("error", () => {});
agent.events.on("revoked", () => void manager.pauseAll("revoked"));
agent.start();

const routes = {
  "GET /status": () => manager.status(),
  "POST /create": (b) => manager.createFromFolder({ dir: b.path, name: b.name, enableSync: b.enableSync !== false }),
  "POST /enable": (b) => manager.enable({ workspaceId: b.workspaceId, dir: b.path, name: b.name, source: b.source }),
  "POST /release": (b) => manager.release(b.workspaceId),
  "POST /now": (b) => manager.syncNow(b.workspaceId),
  "POST /resolve": (b) => manager.resolve(b),
  "POST /inspect": (b) => manager.inspect(b.path),
  "POST /disconnect": () => (agent.stop(), { ok: true }),
  "POST /quit": () => {
    setTimeout(() => process.exit(0), 100);
    return { ok: true };
  },
  // 交接中途被杀：直接退出，不清理（下次启动按交接记录恢复）
  "POST /kill": () => {
    setTimeout(() => process.kill(process.pid, "SIGKILL"), 50);
    return { ok: true };
  },
};
http
  .createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      const fn = routes[`${req.method} ${req.url}`];
      if (!fn) return res.writeHead(404).end();
      try {
        const out = await fn(body ? JSON.parse(body) : {});
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(out));
      } catch (e) {
        res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: e.message }));
      }
    });
  })
  .listen(7788, "127.0.0.1", async () => {
    const ok = await manager.start();
    log(`替身就绪（同步组件 ${ok ? "已启动" : "没启动"}）`);
  });
process.on("SIGTERM", async () => {
  await manager.stop();
  process.exit(0);
});
