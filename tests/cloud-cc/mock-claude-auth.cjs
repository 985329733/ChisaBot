#!/usr/bin/env node
"use strict";
/**
 * 「在云端完成登录」「Claude 上游代理」的 e2e 替身（docs/cloud-claude-code.md）：
 *   :PORT        模拟 Claude 授权页：/oauth/authorize → 登录表单 → 授权按钮 → 跳到 redirect_uri?code=mc-<state>&state=<state>
 *                /cdn-cgi/trace 回 ip=<来源地址>；/_state 看记录（只记邮箱和密码长度，不记密码）
 *   :PROXY_PORT  测试用的 HTTP 上游代理（Basic 认证 PROXY_USER:PROXY_PASS），记下每个 CONNECT / 请求的目标主机：/_log
 */
const http = require("node:http");
const net = require("node:net");

const PORT = Number(process.env.PORT || 8791);
const PROXY_PORT = Number(process.env.PROXY_PORT || 8793);
const PUSER = process.env.PROXY_USER || "proxyuser";
const PPASS = process.env.PROXY_PASS || "proxy-secret-pass";
const state = { authorizeHits: [], logins: [], approved: 0, traces: [] };
const plog = { connects: [], requests: [], authFail: 0 };

const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;background:#f5f1ea;margin:0;display:grid;place-items:center;min-height:100vh}main{background:#fff;padding:28px 32px;border-radius:16px;box-shadow:0 8px 30px #0001;width:min(360px,86vw)}
h1{font-size:22px;margin:0 0 16px}label{display:block;font-size:13px;margin:12px 0 4px}input{width:100%;box-sizing:border-box;padding:10px;border:1px solid #ccc;border-radius:8px;font-size:15px}
button{margin-top:18px;width:100%;padding:11px;border:0;border-radius:8px;background:#c96442;color:#fff;font-size:15px;cursor:pointer}code{display:block;word-break:break-all;background:#f3f3f3;padding:10px;border-radius:8px}</style></head><body><main>${body}</main></body></html>`;

function readBody(req) {
  return new Promise((resolve) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => resolve(d));
  });
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const ip = (req.socket.remoteAddress || "").replace(/^::ffff:/, "");
    if (url.pathname === "/_state") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(state));
    }
    if (url.pathname === "/cdn-cgi/trace") {
      state.traces.push(ip);
      res.writeHead(200, { "content-type": "text/plain" });
      return res.end(`fl=mock\nh=${req.headers.host}\nip=${ip}\nts=${Date.now() / 1000}\n`);
    }
    if (url.pathname === "/oauth/authorize") {
      state.authorizeHits.push({ ip, at: Date.now() });
      const s = url.searchParams.get("state") || "";
      const ru = url.searchParams.get("redirect_uri") || "";
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(
        page(
          "Log in · Claude (mock)",
          `<h1>Log in to Claude</h1><form method="post" action="/oauth/login"><input type="hidden" name="state" value="${s}"><input type="hidden" name="redirect_uri" value="${encodeURIComponent(ru)}">
<label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username">
<label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password"><button id="login" type="submit">Continue</button></form>`,
        ),
      );
    }
    if (url.pathname === "/oauth/login" && req.method === "POST") {
      const f = new URLSearchParams(await readBody(req));
      state.logins.push({ email: f.get("email"), passwordLength: (f.get("password") || "").length, ip });
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(
        page(
          "Authorize · Claude (mock)",
          `<h1>Authorize Claude Code</h1><p>Claude Code would like to connect to your Claude account (${String(f.get("email") || "").replace(/[<>&"]/g, "")}).</p>
<form method="get" action="/oauth/approve"><input type="hidden" name="state" value="${f.get("state") || ""}"><input type="hidden" name="redirect_uri" value="${f.get("redirect_uri") || ""}"><button id="authorize" type="submit">Authorize</button></form>`,
        ),
      );
    }
    if (url.pathname === "/oauth/approve") {
      state.approved++;
      const s = url.searchParams.get("state") || "";
      const ru = decodeURIComponent(url.searchParams.get("redirect_uri") || "");
      res.writeHead(302, { location: `${ru}?code=mc-${s}&state=${s}` });
      return res.end();
    }
    if (url.pathname === "/oauth/code/callback") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(page("Authentication Code", `<h1>Authentication Code</h1><p>Paste this into Claude Code:</p><code>${url.searchParams.get("code")}#${url.searchParams.get("state")}</code>`));
    }
    res.writeHead(404);
    res.end("not found");
  })
  .listen(PORT, "0.0.0.0", () => console.log(`mock claude auth on :${PORT}`));

// ---- 测试上游代理 ----
function authed(req) {
  const h = req.headers["proxy-authorization"] || "";
  return h === `Basic ${Buffer.from(`${PUSER}:${PPASS}`).toString("base64")}`;
}
const proxy = http.createServer((req, res) => {
  if (req.url === "/_log") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(plog));
  }
  if (!authed(req)) {
    plog.authFail++;
    res.writeHead(407, { "proxy-authenticate": 'Basic realm="test"' });
    return res.end();
  }
  let u;
  try {
    u = new URL(req.url);
  } catch {
    res.writeHead(400);
    return res.end();
  }
  plog.requests.push(u.hostname);
  const headers = { ...req.headers };
  delete headers["proxy-authorization"];
  const up = http.request({ host: u.hostname, port: u.port || 80, path: `${u.pathname}${u.search}`, method: req.method, headers }, (r) => {
    res.writeHead(r.statusCode || 502, r.headers);
    r.pipe(res);
  });
  up.on("error", () => {
    res.writeHead(502);
    res.end();
  });
  req.pipe(up);
});
proxy.on("connect", (req, sock, head) => {
  sock.on("error", () => {});
  if (!authed(req)) {
    plog.authFail++;
    return sock.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="test"\r\n\r\n');
  }
  const [host, port] = String(req.url).split(":");
  plog.connects.push(host);
  const up = net.connect(Number(port) || 443, host, () => {
    sock.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head && head.length) up.write(head);
    up.pipe(sock);
    sock.pipe(up);
  });
  up.on("error", () => sock.destroy());
});
proxy.listen(PROXY_PORT, "0.0.0.0", () => console.log(`test proxy on :${PROXY_PORT}`));
