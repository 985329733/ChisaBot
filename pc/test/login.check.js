"use strict";
/* 本机登录页（0.2.5）：地址规范化、探测、直接请求登录网关、错误分类；Android 用的是同一份登录页。 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const auth = require("../src/agent/auth");

function res(status, body, headers = {}) {
  const h = new Headers(headers);
  if (headers["set-cookie"]) h.getSetCookie = () => [].concat(headers["set-cookie"]);
  return { status, ok: status >= 200 && status < 300, headers: h, json: async () => (typeof body === "string" ? JSON.parse(body) : body) };
}

test("normalizeServerUrl adds https:// and strips the trailing slash / path", () => {
  assert.equal(auth.normalizeServerUrl("ayase.example:8443/"), "https://ayase.example:8443");
  assert.equal(auth.normalizeServerUrl(" https://x.example/chat/// "), "https://x.example");
  assert.throws(() => auth.normalizeServerUrl("http://x.example"), /https/);
  assert.throws(() => auth.normalizeServerUrl(""), /服务器地址/);
});

test("probe: gateway /auth/session reachable without login", async () => {
  const calls = [];
  const fetchImpl = async (url) => (calls.push(url), res(200, { authenticated: false }));
  const r = await auth.probe({ serverUrl: "x.example", fetchImpl });
  assert.deepEqual(r, { origin: "https://x.example", gateway: true, authenticated: false });
  assert.equal(calls[0], "https://x.example/auth/session");
});

test("probe: non-gateway server answers /health or a 401 on /api/version", async () => {
  const fetchImpl = async (url) => (url.endsWith("/auth/session") ? res(404, {}) : url.endsWith("/health") ? res(404, {}) : res(401, {}));
  const r = await auth.probe({ serverUrl: "https://x.example", fetchImpl });
  assert.equal(r.gateway, false);
});

test("probe: DNS failure → 地址无法连接, TLS failure → 证书错误", async () => {
  const dns = async () => {
    throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
  };
  await assert.rejects(auth.probe({ serverUrl: "nope.example", fetchImpl: dns }), (e) => e.kind === "unreachable" && /地址无法连接/.test(e.message));
  const tls = async () => {
    throw Object.assign(new TypeError("fetch failed"), { cause: { code: "CERT_HAS_EXPIRED" } });
  };
  await assert.rejects(auth.probe({ serverUrl: "old.example", fetchImpl: tls }), (e) => e.kind === "cert" && /证书错误/.test(e.message));
});

test("login posts exactly what the gateway's web form posts, with Origin and the remember flag", async () => {
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return res(200, { ok: true, next: "/" }, { "set-cookie": "__Host-openbot_session=abc; Path=/; Secure; HttpOnly; SameSite=Lax" });
  };
  const r = await auth.login({ serverUrl: "x.example", username: "me", password: "pw", remember: false, fetchImpl });
  assert.equal(seen.url, "https://x.example/auth/login");
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.init.headers.Origin, "https://x.example");
  assert.equal(seen.init.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(seen.init.body), { username: "me", password: "pw", remember: false });
  assert.equal(r.cookies[0].name, "__Host-openbot_session");
  assert.equal(r.cookies[0].maxAge, undefined, "没勾记住登录 = 会话 Cookie");
});

test("login: 401 → 账号或密码错误, 429 → 尝试次数过多", async () => {
  await assert.rejects(auth.login({ serverUrl: "x.example", username: "a", password: "b", fetchImpl: async () => res(401, {}) }), (e) => e.kind === "auth" && e.message === "账号或密码错误。");
  await assert.rejects(auth.login({ serverUrl: "x.example", username: "a", password: "b", fetchImpl: async () => res(429, {}) }), (e) => e.kind === "rate");
});

test("login page: CSP-clean, has the four fields, and the Android copy is identical", () => {
  const UI = path.join(__dirname, "..", "src", "ui");
  const html = fs.readFileSync(path.join(UI, "login.html"), "utf8");
  for (const id of ['id="server"', 'id="user"', 'id="pass"', 'id="remember"', 'id="toggle"', 'id="history"']) assert.ok(html.includes(id), id);
  assert.ok(!html.includes("../../assets"), "不能引用 PC 专有路径（Android 共用）");
  const android = path.join(__dirname, "..", "..", "android", "app", "src", "main", "assets", "login");
  for (const file of ["login.html", "login.css", "login.js", "ui.css", "ui.js", "sky.js", "skyglass-tokens.css"]) {
    assert.equal(fs.readFileSync(path.join(android, file), "utf8"), fs.readFileSync(path.join(UI, file), "utf8"), `android/…/assets/login/${file} 过期：运行 node scripts/sync-login-android.mjs`);
  }
});

test("main process: no setup wizard left, login channels go through the local-page check", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "src", "main.js"), "utf8");
  assert.ok(!main.includes("setup.html") && !main.includes("openSetup"));
  for (const ch of ["login:probe", "login:submit", "login:forget", "login:open"]) assert.ok(main.includes(`handleLocal("${ch}"`), ch);
  assert.ok(main.includes('"will-redirect"') && main.includes("sessionExpired"), "会话过期时换本机登录页");
  assert.ok(main.includes("切换服务器") && main.includes("退出登录"), "托盘菜单");
  const preload = fs.readFileSync(path.join(__dirname, "..", "src", "preload.js"), "utf8");
  assert.ok(!preload.includes("setup:"));
});
