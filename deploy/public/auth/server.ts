import { Database } from "bun:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync } from "node:fs";

const COOKIE = "__Host-openbot_session";
const SHORT_LIFETIME = 12 * 3600;
const LONG_LIFETIME = 30 * 24 * 3600;
const WINDOW = 15 * 60 * 1000;
const BASE = "https://openbot.invalid";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

/** Only relative destinations in the workspace are valid after sign-in. */
export function safeNext(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048) return "/";
  let decoded = value;
  for (let i = 0; i < 4; i++) {
    if (!decoded.startsWith("/") || decoded.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(decoded)) return "/";
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch { return "/"; }
  }
  if (/%(?:2f|5c|25)/i.test(decoded)) return "/";
  const url = new URL(decoded, BASE);
  if (url.origin !== BASE || /^\/(?:login|sign|auth|_openbot|_internal)(?:\/|$)/.test(url.pathname)) return "/";
  return value;
}

function sessionToken(request: Request): string | null {
  const cookie = request.headers.get("Cookie") || "";
  if (cookie.length > 8192) return null;
  const matches = cookie.split(";").map((part) => part.trim()).filter((part) => part.startsWith(COOKIE + "="));
  if (matches.length !== 1) return null;
  const token = matches[0]!.slice(COOKIE.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

function cookieHeader(token: string, lifetime?: number): string {
  return `${COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax${lifetime === undefined ? "" : `; Max-Age=${lifetime}`}`;
}
function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers } });
}
const unauthorized = () => json({ ok: false, error: "请先登录。", openbotAuthRequired: true }, 401);

const STARTUP_EVENTS = new Set(["shell", "entry-loaded", "entry-executing", "react-mounted", "error", "timeout"]);
const STARTUP_CATEGORIES = new Set(["resource", "syntax", "runtime", "promise", "unknown"]);
const STARTUP_ERROR_NAMES = new Set(["Error", "TypeError", "ReferenceError", "SyntaxError", "RangeError", "SecurityError", "AbortError"]);
type StartupReport = { id: string; event: string; stage: string; resource?: string; category?: string; name?: string; line?: number; column?: number; at: number; browser: string };
function startupMetadata(value: unknown): Omit<StartupReport, "at" | "browser"> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !["id", "event", "stage", "resource", "category", "name", "line", "column"].includes(key))) return null;
  if (typeof body.id !== "string" || !/^[A-Za-z0-9_-]{8,32}$/.test(body.id)) return null;
  if (typeof body.event !== "string" || !STARTUP_EVENTS.has(body.event) || typeof body.stage !== "string" || !STARTUP_EVENTS.has(body.stage)) return null;
  if (body.resource !== undefined && (typeof body.resource !== "string" || !/^[A-Za-z0-9._-]{1,120}$/.test(body.resource))) return null;
  if (body.category !== undefined && (typeof body.category !== "string" || !STARTUP_CATEGORIES.has(body.category))) return null;
  if (body.name !== undefined && (typeof body.name !== "string" || !STARTUP_ERROR_NAMES.has(body.name))) return null;
  for (const key of ["line", "column"]) if (body[key] !== undefined && (typeof body[key] !== "number" || !Number.isInteger(body[key]) || (body[key] as number) < 0 || (body[key] as number) > 10_000_000)) return null;
  return { id: body.id, event: body.event, stage: body.stage, ...(body.resource ? { resource: body.resource as string } : {}), ...(body.category ? { category: body.category as string } : {}), ...(body.name ? { name: body.name as string } : {}), ...(body.line !== undefined ? { line: body.line as number } : {}), ...(body.column !== undefined ? { column: body.column as number } : {}) };
}
function startupBrowser(agent: string): string {
  for (const [pattern, name] of [[/Edg\/(\d{1,3})\./, "Edge"], [/Chrome\/(\d{1,3})\./, "Chrome"], [/Firefox\/(\d{1,3})\./, "Firefox"], [/Version\/(\d{1,3})\..*Safari\//, "Safari"]] as const) {
    const match = agent.match(pattern);
    if (match) return `${name} ${match[1]}`;
  }
  return "Other";
}

export type AuthConfig = {
  databasePath: string;
  username: string;
  passwordHash: string;
  publicOrigin: string;
  now?: () => number;
  /**
   * 应用服务的本机地址（手机扫码绑定用，DESIGN.md §33）：网关用它校验手机的设备令牌、定期确认手机没被撤销。
   * 默认 http://127.0.0.1:3001；必须是直连，不能经过公网 Nginx（应用只回答不带 X-Forwarded-For 的状态查询）。
   */
  appUrl?: string;
  /** 测试注入用。 */
  appFetch?: (input: string, init?: RequestInit) => Promise<Response>;
};

/** 手机会话每隔这么久向应用确认一次设备仍有效；应用暂时连不上时，最多沿用上次结果这么久。 */
const DEVICE_RECHECK_MS = 30_000;
const DEVICE_GRACE_MS = 10 * 60_000;

export function createAuthApp(config: AuthConfig) {
  if (!config.username || !config.passwordHash.startsWith("$argon2id$") || new URL(config.publicOrigin).protocol !== "https:") throw new Error("Invalid authentication configuration");
  const now = config.now || Date.now;
  const appUrl = (config.appUrl || "http://127.0.0.1:3001").replace(/\/+$/, "");
  // globalThis.fetch：下面的请求处理函数也叫 fetch，直接写 fetch 会调用到它自己。
  const appFetch = config.appFetch || ((input: string, init?: RequestInit) => globalThis.fetch(input, init));
  const credentialKey = digest(config.username + "\0" + config.passwordHash);
  const db = new Database(config.databasePath, { create: true, strict: true });
  db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
  db.exec(`CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, credential_key TEXT NOT NULL,
    expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
  ); CREATE TABLE IF NOT EXISTS attempts (
    client_key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL
  ); CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);`);
  // 手机扫码绑定的会话：记下设备 id 和最后一次确认时间（旧库原地加列）。
  const columns = new Set((db.query("PRAGMA table_info(sessions)").all() as { name: string }[]).map((column) => column.name));
  if (!columns.has("device_id")) db.exec("ALTER TABLE sessions ADD COLUMN device_id TEXT");
  if (!columns.has("verified_at")) db.exec("ALTER TABLE sessions ADD COLUMN verified_at INTEGER");
  if (config.databasePath !== ":memory:") chmodSync(config.databasePath, 0o600);
  let inFlight = 0;
  let cleanedAt = -Infinity;
  // Brief, bounded diagnostics stay on this server. No messages, URLs, credentials or full UA.
  const startupReports: StartupReport[] = [];
  const startupCounts = new Map<string, { count: number; at: number }>();
  function cleanStartupReports() {
    const cutoff = now() - 20 * 60_000;
    while (startupReports.length && startupReports[0]!.at <= cutoff) startupReports.shift();
    for (const [key, value] of startupCounts) if (value.at <= cutoff) startupCounts.delete(key);
  }
  function clean() {
    const time = now();
    if (time - cleanedAt < 60_000) return;
    db.query("DELETE FROM sessions WHERE expires_at <= ? OR credential_key <> ?").run(time, credentialKey);
    db.query("DELETE FROM attempts WHERE expires_at <= ?").run(time);
    cleanedAt = time;
  }
  /** 问应用：这台手机还有效吗？true / false；连不上或回答异常 = null。 */
  async function deviceActive(deviceId: string): Promise<boolean | null> {
    try {
      const response = await appFetch(`${appUrl}/api/devices/agent/state/${encodeURIComponent(deviceId)}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) return null;
      const body = (await response.json()) as { active?: unknown };
      return typeof body.active === "boolean" ? body.active : null;
    } catch { return null; }
  }
  async function authenticated(request: Request): Promise<boolean> {
    clean();
    const token = sessionToken(request);
    if (!token) return false;
    const hash = digest(token);
    const row = db.query("SELECT device_id, verified_at FROM sessions WHERE token_hash = ? AND credential_key = ? AND expires_at > ?").get(hash, credentialKey, now()) as { device_id: string | null; verified_at: number | null } | null;
    if (!row) return false;
    if (!row.device_id) return true;
    // 手机会话：撤销 / 删除设备后，最迟约 30 秒失效。
    const verifiedAt = row.verified_at || 0;
    if (now() - verifiedAt < DEVICE_RECHECK_MS) return true;
    const active = await deviceActive(row.device_id);
    if (active === true) {
      db.query("UPDATE sessions SET verified_at = ? WHERE token_hash = ?").run(now(), hash);
      return true;
    }
    if (active === false) {
      db.query("DELETE FROM sessions WHERE device_id = ?").run(row.device_id);
      return false;
    }
    return now() - verifiedAt < DEVICE_GRACE_MS;
  }
  function revoke(request: Request) {
    const token = sessionToken(request);
    if (token) db.query("DELETE FROM sessions WHERE token_hash = ?").run(digest(token));
  }
  function attempt(key: string) {
    db.query(`INSERT INTO attempts (client_key, count, expires_at) VALUES (?, 1, ?)
      ON CONFLICT(client_key) DO UPDATE SET count = count + 1`).run(key, now() + WINDOW);
  }
  /**
   * 手机扫码绑定后的登录（DESIGN.md §33）：手机带着设备令牌（X-Device-Token）来换网关会话。
   * 网关把令牌交给应用 /api/devices/agent/session 校验（只认未撤销的手机设备），通过就签发 30 天会话，
   * 会话上记下设备 id；之后每 30 秒左右确认一次设备仍有效，撤销即失效。和密码登录共用失败限速。
   */
  async function deviceSession(request: Request): Promise<Response> {
    if (request.method !== "POST") return json({ ok: false, error: "请求方法不支持。" }, 405, { Allow: "POST" });
    if (request.headers.get("Origin") !== config.publicOrigin) return json({ ok: false, error: "登录请求来源无效，请确认服务器地址。" }, 403);
    clean();
    const clientKey = digest(`client:${request.headers.get("X-OpenBot-Client") || "unknown"}`);
    const failures = db.query("SELECT count FROM attempts WHERE client_key = ? AND expires_at > ?").get(clientKey, now()) as { count: number } | null;
    if ((failures?.count || 0) >= 10) return json({ ok: false, error: "尝试次数过多，请稍后再试。" }, 429, { "Retry-After": "60" });
    const deviceToken = (request.headers.get("X-Device-Token") || "").trim();
    if (!/^cbd_[A-Za-z0-9_-]{43}$/.test(deviceToken)) {
      attempt(clientKey);
      return json({ ok: false, error: "设备令牌无效，请重新扫码绑定。" }, 401);
    }
    const text = await request.text();
    if (Buffer.byteLength(text) > 1024) return json({ ok: false, error: "请求过长。" }, 413);
    let facts: Record<string, unknown> = {};
    try { const parsed = text ? JSON.parse(text) : {}; if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) facts = parsed; } catch { /* 附带信息可选 */ }
    let reply: Response;
    try {
      reply = await appFetch(`${appUrl}/api/devices/agent/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", "X-Device-Token": deviceToken },
        body: JSON.stringify({ clientVersion: facts.clientVersion, osVersion: facts.osVersion }),
        signal: AbortSignal.timeout(5000),
      });
    } catch { return json({ ok: false, error: "服务器暂时不可用，请稍后重试。" }, 503); }
    if (reply.status === 401 || reply.status === 403) {
      attempt(clientKey);
      const body = (await reply.json().catch(() => ({}))) as { revoked?: unknown };
      return json({ ok: false, revoked: body.revoked === true, error: body.revoked === true ? "这台手机已在网页上被撤销，请重新扫码绑定。" : "设备令牌无效，请重新扫码绑定。" }, 401);
    }
    if (!reply.ok) return json({ ok: false, error: "服务器暂时不可用，请稍后重试。" }, 503);
    const body = (await reply.json().catch(() => null)) as { device?: { id?: unknown; name?: unknown } } | null;
    const deviceId = typeof body?.device?.id === "string" ? body.device.id : null;
    if (!deviceId) return json({ ok: false, error: "服务器暂时不可用，请稍后重试。" }, 503);
    db.query("DELETE FROM attempts WHERE client_key = ?").run(clientKey);
    const token = randomBytes(32).toString("base64url");
    db.transaction(() => {
      revoke(request);
      db.query("INSERT INTO sessions (token_hash, credential_key, expires_at, created_at, device_id, verified_at) VALUES (?, ?, ?, ?, ?, ?)").run(digest(token), credentialKey, now() + LONG_LIFETIME * 1000, now(), deviceId, now());
      db.query("DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions ORDER BY created_at DESC LIMIT -1 OFFSET 100)").run();
    })();
    return json({ ok: true, device: { id: deviceId, name: typeof body?.device?.name === "string" ? body.device.name : null } }, 200, { "Set-Cookie": cookieHeader(token, LONG_LIFETIME) });
  }

  async function fetch(request: Request): Promise<Response> {
    try {
      const path = new URL(request.url).pathname;
      if (path === "/_internal/health" && request.method === "GET") return json({ ok: true });
      // The auth listener is loopback-only; Nginx rejects every public /_internal/ path.
      if (path === "/_internal/startup-reports" && request.method === "GET") {
        cleanStartupReports();
        return json({ reports: startupReports });
      }
      if (path === "/_internal/check" && request.method === "GET") return (await authenticated(request)) ? json({ ok: true }) : unauthorized();
      if (path === "/_internal/unauthorized") {
        const original = request.headers.get("X-Original-URI") || "/";
        const method = request.headers.get("X-Original-Method");
        const navigate = request.headers.get("X-Original-Fetch-Mode") === "navigate" || (request.headers.get("Accept") || "").includes("text/html");
        if ((method === "GET" || method === "HEAD") && navigate && !/^\/(?:api|health)(?:\/|\?|$)/.test(original)) {
          return new Response(null, { status: 302, headers: { Location: "/login?next=" + encodeURIComponent(safeNext(original)), "Cache-Control": "no-store" } });
        }
        return unauthorized();
      }
      if (path === "/auth/session" && request.method === "GET") {
        const valid = await authenticated(request);
        return json(valid ? { authenticated: true, username: config.username } : { authenticated: false });
      }
      if (path === "/auth/startup-report") {
        if (request.method !== "POST") return json({ ok: false }, 405, { Allow: "POST" });
        if (request.headers.get("Origin") !== config.publicOrigin) return json({ ok: false }, 403);
        // A diagnostic refusal must not activate the workspace's login redirect interceptor.
        if (!(await authenticated(request))) return json({ ok: false }, 401);
        if ((request.headers.get("Content-Type") || "").split(";")[0]?.trim().toLowerCase() !== "application/json") return json({ ok: false }, 415);
        const text = await request.text();
        if (Buffer.byteLength(text) > 512) return json({ ok: false }, 413);
        let body: unknown;
        try { body = JSON.parse(text); } catch { return json({ ok: false }, 400); }
        const report = startupMetadata(body);
        if (!report) return json({ ok: false }, 400);
        cleanStartupReports();
        const key = digest(sessionToken(request)! + ":" + report.id);
        const count = startupCounts.get(key);
        if (count && count.count >= 8) return json({ ok: false }, 429);
        startupCounts.set(key, { count: (count?.count || 0) + 1, at: now() });
        while (startupCounts.size > 100) startupCounts.delete(startupCounts.keys().next().value!);
        startupReports.push({ ...report, at: now(), browser: startupBrowser(request.headers.get("User-Agent") || "") });
        while (startupReports.length > 100) startupReports.shift();
        return json({ ok: true }, 202);
      }
      if (path === "/auth/device-session") return await deviceSession(request);
      if (path !== "/auth/login" && path !== "/auth/logout") return json({ ok: false, error: "页面不存在。" }, 404);
      if (request.method !== "POST") return json({ ok: false, error: "请求方法不支持。" }, 405, { Allow: "POST" });
      if (request.headers.get("Origin") !== config.publicOrigin) return json({ ok: false, error: "登录请求来源无效，请刷新页面重试。" }, 403);
      const contentType = (request.headers.get("Content-Type") || "").split(";")[0]?.trim().toLowerCase();
      // The app's existing sign-out request has no body or Content-Type.
      // Origin validation remains mandatory for both logout entry points.
      if (contentType !== "application/json" && !(path === "/auth/logout" && !contentType)) return json({ ok: false, error: "请求格式无效，请刷新页面重试。" }, 415);
      if (path === "/auth/logout") {
        revoke(request);
        return json({ ok: true }, 200, { "Set-Cookie": cookieHeader("", 0) });
      }
      clean();
      const text = await request.text();
      if (Buffer.byteLength(text) > 4096) return json({ ok: false, error: "请求过长。" }, 413);
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(text);
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
      } catch { return json({ ok: false, error: "请求格式无效。" }, 400); }
      const clientKey = digest("client:" + (request.headers.get("X-OpenBot-Client") || "unknown"));
      const failures = db.query("SELECT count, expires_at FROM attempts WHERE client_key = ? AND expires_at > ?").get(clientKey, now()) as { count: number; expires_at: number } | null;
      const global = db.query("SELECT count, expires_at FROM attempts WHERE client_key = 'global' AND expires_at > ?").get(now()) as { count: number; expires_at: number } | null;
      if ((failures?.count || 0) >= 10 || (global?.count || 0) >= 1000 || inFlight >= 2) {
        const retry = inFlight >= 2 ? 2 : Math.max(1, Math.ceil(((failures?.expires_at || global?.expires_at || now() + WINDOW) - now()) / 1000));
        return json({ ok: false, error: "尝试次数过多，请稍后再试。" }, 429, { "Retry-After": String(retry) });
      }
      const validInput = typeof body.username === "string" && body.username.length <= 64 && typeof body.password === "string" && body.password.length > 0 && body.password.length <= 1024;
      let correct = false;
      if (validInput) {
        inFlight++;
        try { correct = (await Bun.password.verify(body.password as string, config.passwordHash)) && body.username === config.username; }
        finally { inFlight--; }
      }
      if (!correct) {
        attempt(clientKey); attempt("global");
        return json({ ok: false, error: "账号或密码不正确，请重试。" }, 401);
      }
      db.query("DELETE FROM attempts WHERE client_key = ?").run(clientKey);
      const token = randomBytes(32).toString("base64url");
      const lifetime = body.remember === true ? LONG_LIFETIME : SHORT_LIFETIME;
      db.transaction(() => {
        revoke(request);
        db.query("INSERT INTO sessions (token_hash, credential_key, expires_at, created_at) VALUES (?, ?, ?, ?)").run(digest(token), credentialKey, now() + lifetime * 1000, now());
        db.query("DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions ORDER BY created_at DESC LIMIT -1 OFFSET 100)").run();
      })();
      return json({ ok: true, next: safeNext(body.next) }, 200, { "Set-Cookie": cookieHeader(token, body.remember === true ? lifetime : undefined) });
    } catch {
      // Never log request bodies, password hashes, cookies, or session tokens.
      return json({ ok: false, error: "登录服务暂时不可用，请稍后重试。" }, 503);
    }
  }
  return { fetch, close: () => db.close() };
}

if (import.meta.main) {
  process.umask(0o077);
  const stored = await Bun.file(process.env.OPENBOT_AUTH_CONFIG || "/auth/config.json").json();
  const app = createAuthApp({ ...stored, databasePath: process.env.OPENBOT_AUTH_DB || "/auth-data/sessions.sqlite", ...(process.env.OPENBOT_AUTH_APP_URL ? { appUrl: process.env.OPENBOT_AUTH_APP_URL } : {}) });
  const server = Bun.serve({ hostname: "127.0.0.1", port: Number(process.env.OPENBOT_AUTH_PORT || 3002), maxRequestBodySize: 4096, fetch: app.fetch });
  console.log("ChisaBot web authentication listening on loopback");
  const stop = () => { server.stop(true); app.close(); process.exit(0); };
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
}
