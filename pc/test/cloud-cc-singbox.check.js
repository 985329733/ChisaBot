"use strict";
// 「Claude 上游代理」的节点链接转换（pc/src/cloud-cc/singbox.js，DESIGN.md §85）。
// 需要 sing-box（CHISABOT_SINGBOX 或 /usr/local/bin/sing-box）；没有就跳过（CI 的 PC 检查里没有，云端节点镜像 / 预览里有）。
// 本机起一个 sing-box trojan 服务端（自签证书），节点那边起转换器，转发器经它连到本机的 http 测试服务。
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const net = require("node:net");
const path = require("node:path");
const http = require("node:http");
const { spawn, execFileSync } = require("node:child_process");

process.env.CHISABOT_CLAUDE_HOSTS_EXTRA = "127.0.0.1";
const { createSingBox, cleanOutbound, scrub, singBoxPath, singBoxVersion } = require("../src/cloud-cc/singbox");
const { createForwarder } = require("../src/cloud-cc/proxy");

const BIN = singBoxPath();
const HAVE = (() => {
  try {
    fs.accessSync(BIN, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
})();
const PASSWORD = "tr0jan-p@ss:w/rd";

let dir;
let server;
let target;
let targetPort;
let serverPort;
let serverLog = "";

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/** 经转发器 CONNECT 到 host:port，发一个 GET，返回回应。 */
function viaForwarder(fport, host, port, pathName) {
  return new Promise((resolve, reject) => {
    const s = net.connect(fport, "127.0.0.1", () => s.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`));
    let buf = "";
    let tunneled = false;
    s.on("data", (d) => {
      buf += d.toString();
      if (!tunneled && buf.includes("\r\n\r\n")) {
        if (!/^HTTP\/1\.1 200/.test(buf)) return reject(new Error(buf.split("\r\n")[0]));
        tunneled = true;
        buf = "";
        s.write(`GET ${pathName} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
      }
    });
    s.on("end", () => resolve(buf));
    s.on("error", reject);
  });
}

function outbound(extra = {}) {
  return { type: "trojan", tag: "whatever", server: "127.0.0.1", server_port: serverPort, password: PASSWORD, tls: { enabled: true, server_name: "localhost.test", insecure: true }, detour: "evil", ...extra };
}

test.before(async () => {
  if (!HAVE) return;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-sbx-"));
  const kp = execFileSync(BIN, ["generate", "tls-keypair", "localhost.test", "-m", "1"]).toString();
  const key = kp.slice(kp.indexOf("-----BEGIN PRIVATE KEY"), kp.indexOf("-----END PRIVATE KEY-----") + 25);
  const cert = kp.slice(kp.indexOf("-----BEGIN CERTIFICATE"), kp.indexOf("-----END CERTIFICATE-----") + 25);
  fs.writeFileSync(path.join(dir, "key.pem"), key);
  fs.writeFileSync(path.join(dir, "cert.pem"), cert);
  serverPort = await freePort();
  const cfg = {
    log: { level: "info" },
    inbounds: [{ type: "trojan", listen: "127.0.0.1", listen_port: serverPort, users: [{ password: PASSWORD }], tls: { enabled: true, certificate_path: path.join(dir, "cert.pem"), key_path: path.join(dir, "key.pem") } }],
    outbounds: [{ type: "direct" }],
  };
  fs.writeFileSync(path.join(dir, "srv.json"), JSON.stringify(cfg));
  server = spawn(BIN, ["run", "--disable-color", "-c", path.join(dir, "srv.json")], { stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (d) => (serverLog += d));
  server.stderr.on("data", (d) => (serverLog += d));
  target = http.createServer((req, res) => res.end(`hello via ${req.url}`));
  await new Promise((r) => target.listen(0, "127.0.0.1", r));
  targetPort = target.address().port;
  for (let i = 0; i < 50 && !/started/.test(serverLog); i++) await new Promise((r) => setTimeout(r, 100));
});
test.after(() => {
  server?.kill();
  target?.close();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

test("出站检查：类型白名单、tag 固定、去掉 detour", () => {
  assert.throws(() => cleanOutbound({ type: "direct", server: "x", server_port: 1 }), /不支持/);
  assert.throws(() => cleanOutbound({ type: "trojan" }), /服务器地址/);
  assert.throws(() => cleanOutbound(null), /不对/);
  const o = cleanOutbound({ type: "vless", server: "h", server_port: 443, uuid: "u", detour: "x", bind_interface: "eth0", tag: "t" });
  assert.equal(o.tag, "up");
  assert.equal(o.detour, undefined);
  assert.equal(o.bind_interface, undefined);
  assert.equal(scrub("\x1b[31mpassword=abc123 x\x1b[0m", ["abc123"]), "password=•••• x");
});

test("没有 sing-box 时说清楚", async () => {
  const sb = createSingBox({ bin: "/nonexistent/sing-box" });
  await assert.rejects(sb.start(outbound()), /没有 sing-box/);
  assert.equal(await singBoxVersion("/nonexistent/sing-box"), null);
});

test("trojan 节点 → 本机 socks5 → 转发器：Claude 的域名经节点走，日志里没有密码", { skip: !HAVE && "没有 sing-box" }, async () => {
  assert.match(String(await singBoxVersion()), /^\d+\.\d+/);
  const logs = [];
  const sb = createSingBox({ log: (l) => logs.push(l) });
  const url = await sb.start(outbound());
  assert.match(url, /^socks5:\/\/[0-9a-f]{12}:[^@]+@127\.0\.0\.1:\d+$/);
  // socks5 入站要认证：不带账号密码连不上
  const port = Number(url.split(":").pop());
  const noAuth = await new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1", () => s.write(Buffer.from([5, 1, 0])));
    s.once("data", (d) => {
      s.destroy();
      resolve(d[1]);
    });
    s.once("error", () => resolve(-1));
  });
  assert.equal(noAuth, 0xff);
  const fwd = createForwarder();
  fwd.setUpstream(url);
  const fport = await fwd.start();
  const body = await viaForwarder(fport, "127.0.0.1", targetPort, "/claude-check");
  assert.match(body, /hello via \/claude-check/);
  assert.equal(fwd.stats.viaUpstream, 1);
  await new Promise((r) => setTimeout(r, 200));
  assert.match(serverLog, new RegExp(`inbound connection to 127\\.0\\.0\\.1:${targetPort}`));
  // 意外退出 → 自动重启（同一端口），之后还能用
  sb._child().kill("SIGKILL");
  for (let i = 0; i < 40 && !logs.some((l) => /已重启/.test(l)); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(logs.some((l) => /已重启/.test(l)), logs.join("\n"));
  assert.match(await viaForwarder(fport, "127.0.0.1", targetPort, "/after-restart"), /after-restart/);
  await sb.stop();
  assert.equal(sb.running(), false);
  fwd.close();
  const all = logs.join("\n");
  assert.ok(!all.includes(PASSWORD), "日志里有节点密码");
  assert.ok(!all.includes(decodeURIComponent(url.split(":")[2].split("@")[0])), "日志里有入站密码");
});

test("密码不对：起来了但连不上；节点不存在：清楚的错误、不回显密码", { skip: !HAVE && "没有 sing-box" }, async () => {
  const sb = createSingBox({ supervise: false });
  const url = await sb.start(outbound({ password: "wrong-password-123" }));
  const fwd = createForwarder();
  fwd.setUpstream(url);
  const fport = await fwd.start();
  // socks5 握手先成功，trojan 服务端认不出密码就断开：拿不到回应
  const got = await viaForwarder(fport, "127.0.0.1", targetPort, "/x").catch((e) => `ERR ${e.message}`);
  assert.ok(!/hello via/.test(got), got);
  await sb.stop();
  fwd.close();
  // 配置本身不对（sing-box 拒绝启动）：错误里不带密码
  const bad = createSingBox({ supervise: false });
  await assert.rejects(bad.start(outbound({ password: "SecretShouldNotLeak", tls: { enabled: true, utls: { enabled: true, fingerprint: "no-such-fp" } } })), (e) => {
    assert.ok(!String(e.message).includes("SecretShouldNotLeak"), e.message);
    return true;
  });
});
