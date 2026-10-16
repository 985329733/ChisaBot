"use strict";
// 电脑文件夹同步（P4a，pc/src/cloud-cc/sync.js + pc/src/sync/tunnel.js）：authorized_keys 的写法、租约（第二道闸）、
// 默认不同步的规则、暂停时清单、隧道两头的字节对接（假 WebSocket + 本机 TCP 代替 sshd）。
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const net = require("node:net");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { createSyncNode, ignored } = require("../src/cloud-cc/sync");
const { pipeTunnel, tunnelUrl } = require("../src/sync/tunnel");

const KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOrW7vYqk4H7qC6lq0q1nW8mXo8bJqk0q0Vd1u0bU9xY";

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cb-sync-"));
}

test("authorized_keys: restrict + gate command, one line per binding, bad input refused", () => {
  const root = tmp();
  const keysDir = path.join(root, "keys");
  const node = createSyncNode({ root, keysDir });
  assert.deepEqual(node.rpc("sync_keys_set", { keys: [{ workspaceId: "ws_a", bindingId: "sb_1", pubKey: `${KEY} me@pc` }] }), { keys: 1 });
  const text = fs.readFileSync(path.join(keysDir, "authorized_keys"), "utf8");
  assert.equal(text, `restrict,command="/usr/local/bin/chisabot-sync-gate ws_a sb_1" ${KEY} chisabot-sb_1\n`);
  assert.throws(() => node.rpc("sync_keys_set", { keys: [{ workspaceId: "../x", bindingId: "sb_1", pubKey: KEY }] }));
  assert.throws(() => node.rpc("sync_keys_set", { keys: [{ workspaceId: "ws_a", bindingId: "sb 1", pubKey: KEY }] }));
  assert.throws(() => node.rpc("sync_keys_set", { keys: [{ workspaceId: "ws_a", bindingId: "sb_1", pubKey: 'ssh-ed25519 AAAA" command="x' }] }));
  assert.deepEqual(node.rpc("sync_keys_set", { keys: [] }), { keys: 0 });
  assert.equal(fs.readFileSync(path.join(keysDir, "authorized_keys"), "utf8"), "");
});

test("lease: cloud may write by default; pc blocks; handoff needs the matching id; unreadable lease is not a release", () => {
  const root = tmp();
  const node = createSyncNode({ root, keysDir: path.join(root, "k") });
  node.assertCloudMayWrite("ws_b");
  node.rpc("sync_lease", { workspaceId: "ws_b", holder: "pc", epoch: 2 });
  assert.throws(() => node.assertCloudMayWrite("ws_b"), /电脑正在使用/);
  node.rpc("sync_lease", { workspaceId: "ws_b", holder: "handoff", handoffId: "ho_1" });
  assert.throws(() => node.assertCloudMayWrite("ws_b"));
  assert.throws(() => node.assertCloudMayWrite("ws_b", "ho_2"));
  node.assertCloudMayWrite("ws_b", "ho_1");
  fs.writeFileSync(path.join(root, "projects", "ws_b", ".chisabot", "lease.json"), "{not json");
  assert.equal(node.rpc("sync_lease_get", { workspaceId: "ws_b" }).holder, "unknown");
  assert.throws(() => node.assertCloudMayWrite("ws_b"));
  assert.throws(() => node.rpc("sync_lease", { workspaceId: "ws_b", holder: "root" }));
});

test("default ignore rules (§4.6)", () => {
  for (const p of ["node_modules/a.js", "src/node_modules/x", ".env", ".env.local", "dist/app.js", "a/__pycache__/m.pyc", ".git/HEAD"]) assert.equal(ignored(p), true, p);
  for (const p of [".env.example", ".env.sample", "src/index.ts", "README.md", "distance.txt"]) assert.equal(ignored(p), false, p);
});

test("ws_init_local + manifest (size + sha256, ignores applied)", () => {
  const root = tmp();
  const node = createSyncNode({ root, keysDir: path.join(root, "k") });
  const r = node.rpc("ws_init_local", { workspaceId: "ws_c" });
  assert.equal(r.path, path.join("projects", "ws_c", "work"));
  assert.equal(node.rpc("sync_lease_get", { workspaceId: "ws_c" }).holder, "syncing");
  const work = path.join(root, r.path);
  fs.writeFileSync(path.join(work, "a.txt"), "hello");
  fs.mkdirSync(path.join(work, "node_modules"));
  fs.writeFileSync(path.join(work, "node_modules", "x.js"), "x");
  fs.writeFileSync(path.join(work, ".env"), "SECRET=1");
  const m = node.rpc("ws_manifest", { workspaceId: "ws_c" });
  assert.deepEqual(Object.keys(m.files), ["a.txt"]);
  assert.equal(m.files["a.txt"].size, 5);
  assert.equal(m.files["a.txt"].sha256, "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
});

/** 假的 ws：两端对接（服务器把两条 WSS 的帧原样转给对方）。 */
class FakeWs extends EventEmitter {
  constructor() {
    super();
    this.readyState = 0;
    this.bufferedAmount = 0;
    this.peer = null;
    setImmediate(() => {
      this.readyState = 1;
      this.emit("open");
    });
  }
  send(data) {
    const copy = Buffer.from(data);
    setImmediate(() => this.peer && this.peer.emit("message", copy));
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    setImmediate(() => this.emit("close"));
    if (this.peer) this.peer.close();
  }
}

test("tunnel: PC stdin/stdout ⇄ (server splice) ⇄ node ⇄ local sshd stand-in, bytes intact both ways", async () => {
  // sshd 的替身：本机回声服务，把收到的每个字节 +1 再发回去
  const echo = net.createServer((s) => s.on("data", (d) => s.write(Buffer.from(d.map((b) => (b + 1) & 255)))));
  await new Promise((r) => echo.listen(0, "127.0.0.1", r));
  const port = echo.address().port;
  let nodeSide = null;
  let pcSide = null;
  const pair = () => {
    if (nodeSide && pcSide) {
      nodeSide.peer = pcSide;
      pcSide.peer = nodeSide;
    }
  };
  const NodeWs = function () {
    nodeSide = new FakeWs();
    pair();
    return nodeSide;
  };
  const PcWs = function (url) {
    assert.match(url, /^ws:\/\/srv\.test\/api\/devices\/agent\/sync-tunnel\?ticket=cbt_x$/);
    pcSide = new FakeWs();
    pair();
    return pcSide;
  };
  const root = tmp();
  const node = createSyncNode({ root, keysDir: path.join(root, "k"), serverUrl: "http://srv.test", getToken: () => "tok", WebSocket: NodeWs, sshPort: port });
  node.handle({ type: "sync_tunnel_open", tunnelId: "tn_1" });
  const input = new PassThrough();
  const output = new PassThrough();
  const got = [];
  output.on("data", (d) => got.push(d));
  const fetchImpl = async (url, init) => {
    assert.equal(url, "http://srv.test/api/devices/agent/sync/ticket");
    assert.equal(init.headers["X-Device-Token"], "tok");
    return { ok: true, status: 200, json: async () => ({ ticket: "cbt_x" }) };
  };
  const done = pipeTunnel({ server: "http://srv.test", token: "tok", workspaceId: "ws_a", input, output, WebSocket: PcWs, fetchImpl });
  const payload = Buffer.alloc(200_000);
  for (let i = 0; i < payload.length; i++) payload[i] = i % 251;
  input.write(payload);
  for (let i = 0; i < 100 && Buffer.concat(got).length < payload.length; i++) await new Promise((r) => setTimeout(r, 20));
  const back = Buffer.concat(got);
  assert.equal(back.length, payload.length);
  assert.ok(back.equals(Buffer.from(payload.map((b) => (b + 1) & 255))));
  assert.equal(node.tunnelCount(), 1);
  input.end();
  assert.equal(await done, 0);
  for (let i = 0; i < 50 && node.tunnelCount(); i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(node.tunnelCount(), 0);
  echo.close();
  assert.equal(tunnelUrl("https://a.example:8443/x", "t"), "wss://a.example:8443/api/devices/agent/sync-tunnel?ticket=t");
});

test("sync_probe (§87): sshd answers SSH- → ok; nothing listening (sidecar in a stale netns) → not ok, Chinese reason", async () => {
  const root = tmp();
  const srv = net.createServer((s) => s.end("SSH-2.0-OpenSSH_9.6\r\n"));
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const port = srv.address().port;
  const ok = await createSyncNode({ root, keysDir: path.join(root, "k"), sshPort: port }).rpc("sync_probe", {});
  assert.deepEqual(ok, { ok: true, error: null });
  await new Promise((r) => srv.close(r));
  const bad = await createSyncNode({ root, keysDir: path.join(root, "k"), sshPort: port }).rpc("sync_probe", {});
  assert.equal(bad.ok, false);
  assert.match(bad.error, /连不上同步边车：ECONNREFUSED/);
});
