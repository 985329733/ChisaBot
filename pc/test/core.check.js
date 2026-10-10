"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { WebSocketServer } = require("ws");
const WebSocket = require("ws");
const { createNodeAgent } = require("../src/agent/core");

function device(overrides = {}) {
  return {
    id: "dev_1",
    name: "测试机",
    paused: false,
    allowedRoots: [],
    capabilities: { shell: "allow", files_read: "off", files_write: "off", screenshot: "off", input: "off", open: "off", clipboard: "ask" },
    ...overrides,
  };
}

function setup(t, { approve, local } = {}) {
  const wss = new WebSocketServer({ port: 0 });
  const port = wss.address().port;
  const received = [];
  let server;
  let lastHeaders;
  const connected = new Promise((resolve) => {
    wss.on("connection", (ws, req) => {
      server = ws;
      lastHeaders = req.headers;
      ws.on("message", (m) => received.push(JSON.parse(String(m))));
      ws.send(JSON.stringify({ type: "welcome", device: device() }));
      resolve(ws);
    });
  });
  const ops = { platform: "linux", run: async (op, args) => (op === "shell" ? { stdout: `ran ${args.command}` } : { op }) };
  const agent = createNodeAgent({ serverUrl: `http://127.0.0.1:${port}`, getToken: () => "cbd_test", ops, WebSocket, approve, local, clientInfo: { clientVersion: "t" } });
  t.after(() => {
    agent.stop();
    wss.close();
  });
  agent.start();
  const waitFor = async (pred) => {
    for (let i = 0; i < 100; i++) {
      const hit = received.find(pred);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error("timeout waiting for message");
  };
  return { agent, connected, received, waitFor, getServer: () => server, headers: () => lastHeaders };
}

test("hello, token header, call → result", async (t) => {
  const s = setup(t);
  const ws = await s.connected;
  await s.waitFor((m) => m.type === "hello");
  assert.equal(s.headers()["x-device-token"], "cbd_test");
  ws.send(JSON.stringify({ type: "call", id: "c1", operation: "shell", args: { command: "dir" }, botName: "主机器人" }));
  const result = await s.waitFor((m) => m.type === "result" && m.id === "c1");
  assert.equal(result.ok, true);
  assert.equal(result.result.stdout, "ran dir");
  assert.equal(s.agent.state, "online");
});

test("capability off and local kill switch refuse locally", async (t) => {
  let paused = false;
  const s = setup(t, { local: () => ({ paused, forceLocalApproval: false }) });
  const ws = await s.connected;
  await s.waitFor((m) => m.type === "hello");
  ws.send(JSON.stringify({ type: "call", id: "c2", operation: "read_file", args: { path: "x" } }));
  const off = await s.waitFor((m) => m.id === "c2");
  assert.equal(off.ok, false);
  assert.match(off.error, /关闭/);
  paused = true;
  ws.send(JSON.stringify({ type: "call", id: "c3", operation: "shell", args: { command: "x" } }));
  const stopped = await s.waitFor((m) => m.id === "c3");
  assert.match(stopped.error, /紧急停止/);
});

test("approval request answered locally; ping/pong; set_config sent", async (t) => {
  const s = setup(t, { approve: async () => "approve" });
  const ws = await s.connected;
  await s.waitFor((m) => m.type === "hello");
  ws.send(JSON.stringify({ type: "approval_request", id: "a1", operation: "clipboard_read", summary: "读取剪贴板", botName: "B" }));
  const decision = await s.waitFor((m) => m.type === "approval");
  assert.equal(decision.decision, "approve");
  ws.send(JSON.stringify({ type: "ping" }));
  await s.waitFor((m) => m.type === "pong");
  s.agent.setConfig({ paused: true });
  const cfg = await s.waitFor((m) => m.type === "set_config");
  assert.equal(cfg.paused, true);
  assert.equal(s.agent.device.paused, true);
});

test("force local approval on dangerous allow", async (t) => {
  const asked = [];
  const s = setup(t, { approve: async (req) => (asked.push(req), "deny"), local: () => ({ paused: false, forceLocalApproval: true }) });
  const ws = await s.connected;
  await s.waitFor((m) => m.type === "hello");
  ws.send(JSON.stringify({ type: "call", id: "c4", operation: "shell", args: { command: "rm" } }));
  const r = await s.waitFor((m) => m.id === "c4");
  assert.equal(r.ok, false);
  assert.equal(asked.length, 1);
});

test("revoked stops reconnecting", async (t) => {
  const s = setup(t);
  const ws = await s.connected;
  await s.waitFor((m) => m.type === "hello");
  const revoked = new Promise((r) => s.agent.events.once("revoked", r));
  ws.send(JSON.stringify({ type: "revoked" }));
  ws.close(4401, "revoked");
  await revoked;
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(s.agent.state, "revoked");
});

test("reconnects after drop", async (t) => {
  const s = setup(t);
  const ws = await s.connected;
  await s.waitFor((m) => m.type === "hello");
  const again = new Promise((r) => s.agent.events.on("state", (e) => e.state === "online" && r()));
  ws.terminate();
  await again;
});
