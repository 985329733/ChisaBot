"use strict";
// 「Claude 上游代理」（pc/src/cloud-cc/proxy.js）和「在云端完成登录」的回调识别（browser.js）。
// 本机转发器：Claude 的域名走上游（http 带认证 / socks5 带认证），其他直连；上游记下了经过它的主机。
const test = require("node:test");
const assert = require("node:assert");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

process.env.CHISABOT_CLAUDE_HOSTS_EXTRA = "127.0.0.1";
const { createForwarder, maskProxy, parseProxy, isClaudeHost, httpsGet } = require("../src/cloud-cc/proxy");
const { codeFromCallback, unheadless } = require("../src/cloud-cc/browser");

const MOCK = path.resolve(__dirname, "../../tests/cloud-cc/mock-claude-auth.cjs");
const PORT = 21000 + Math.floor(Math.random() * 1000);
const PPORT = PORT + 1;
let mock;

test.before(async () => {
  mock = spawn(process.execPath, [MOCK], { env: { ...process.env, PORT: String(PORT), PROXY_PORT: String(PPORT), PROXY_USER: "u1", PROXY_PASS: "p@ss:w0rd" }, stdio: ["ignore", "pipe", "inherit"] });
  let seen = "";
  await new Promise((resolve) => mock.stdout.on("data", (d) => ((seen += d), /test proxy/.test(seen) && resolve())));
});
test.after(() => mock?.kill());

/** 经转发器 CONNECT 到 host:port，发一个 GET，返回回应正文。 */
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
const plog = () => fetch(`http://127.0.0.1:${PPORT}/_log`).then((r) => r.json());

test("地址解析和打码", () => {
  assert.equal(maskProxy("socks5://alice:secret@1.2.3.4:1080"), "socks5://alice:••••@1.2.3.4:1080");
  assert.equal(maskProxy("http://proxy.example.com:3128"), "http://proxy.example.com:3128");
  assert.equal(parseProxy("ftp://x:1"), null);
  assert.equal(parseProxy("http://x.com:3128/path"), null);
  assert.equal(parseProxy("socks5h://a:b@h:1").protocol, "socks5");
  assert.ok(isClaudeHost("api.anthropic.com") && isClaudeHost("claude.ai") && isClaudeHost("platform.claude.com"));
  assert.ok(!isClaudeHost("github.com") && !isClaudeHost("registry.npmjs.org") && !isClaudeHost("notclaude.ai"));
});

test("回调地址 → code#state", () => {
  assert.equal(codeFromCallback("https://platform.claude.com/oauth/code/callback?code=abc&state=xyz"), "abc#xyz");
  assert.equal(unheadless("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/155.0.0.0 Safari/537.36"), "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36");
  assert.equal(codeFromCallback("https://console.anthropic.com/oauth/code/callback?code=abc"), "abc");
  assert.equal(codeFromCallback("https://claude.ai/oauth/authorize?code=true&state=1"), null);
});

test("http 上游（带认证）：Claude 域名经过上游，其他直连", async () => {
  const f = createForwarder();
  const fport = await f.start();
  f.setUpstream(`http://u1:${encodeURIComponent("p@ss:w0rd")}@127.0.0.1:${PPORT}`);
  const before = await plog();
  const body = await viaForwarder(fport, "127.0.0.1", PORT, "/cdn-cgi/trace");
  assert.match(body, /ip=127\.0\.0\.1/);
  const mid = await plog();
  assert.equal(mid.connects.length, before.connects.length + 1, "Claude 域名应经过上游");
  await viaForwarder(fport, "localhost", PORT, "/cdn-cgi/trace");
  assert.equal((await plog()).connects.length, mid.connects.length, "非 Claude 域名直连");
  assert.equal(f.stats.viaUpstream, 1);
  // 密码不对 → 407
  f.setUpstream(`http://u1:wrong@127.0.0.1:${PPORT}`);
  await assert.rejects(viaForwarder(fport, "127.0.0.1", PORT, "/"), /502/);
  f.close();
});

test("socks5 上游（带认证）", async () => {
  const seen = [];
  const socks = net.createServer((c) => {
    c.once("data", (greet) => {
      assert.equal(greet[0], 5);
      c.write(Buffer.from([5, 2]));
      c.once("data", (auth) => {
        const ul = auth[1];
        const user = auth.subarray(2, 2 + ul).toString();
        const pass = auth.subarray(3 + ul, 3 + ul + auth[2 + ul]).toString();
        if (user !== "s" || pass !== "sp") return c.end(Buffer.from([1, 1]));
        c.write(Buffer.from([1, 0]));
        c.once("data", (req) => {
          const len = req[4];
          const host = req.subarray(5, 5 + len).toString();
          const port = req.readUInt16BE(5 + len);
          seen.push(host);
          const up = net.connect(port, host === "localhost" ? "127.0.0.1" : host, () => {
            c.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
            up.pipe(c);
            c.pipe(up);
          });
        });
      });
    });
  });
  await new Promise((r) => socks.listen(0, "127.0.0.1", r));
  process.env.CHISABOT_CLAUDE_HOSTS_EXTRA = "localhost";
  const f = createForwarder();
  const fport = await f.start();
  f.setUpstream(`socks5://s:sp@127.0.0.1:${socks.address().port}`);
  const body = await viaForwarder(fport, "localhost", PORT, "/cdn-cgi/trace");
  assert.match(body, /ip=127\.0\.0\.1/);
  assert.deepEqual(seen, ["localhost"], "socks5 收到的是域名（由代理解析）");
  f.close();
  socks.close();
  process.env.CHISABOT_CLAUDE_HOSTS_EXTRA = "127.0.0.1";
});

test("测试连接真的经过上游：上游接了 CONNECT 就断开 → 必须失败，不能悄悄直连（2026-10-16 修）", async () => {
  const seen = [];
  const bad = net.createServer((sock) => {
    sock.once("data", (d) => {
      seen.push(String(d).split("\r\n")[0]);
      sock.end("HTTP/1.1 200 Connection Established\r\n\r\n");
    });
  });
  await new Promise((r) => bad.listen(0, "127.0.0.1", r));
  const p = parseProxy(`http://127.0.0.1:${bad.address().port}`);
  await assert.rejects(httpsGet("https://claude.ai/cdn-cgi/trace", p, 8000));
  assert.deepEqual(seen, ["CONNECT claude.ai:443 HTTP/1.1"]);
  bad.close();
});
