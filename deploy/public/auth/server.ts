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
};

export function createAuthApp(config: AuthConfig) {
  if (!config.username || !config.passwordHash.startsWith("$argon2id$") || new URL(config.publicOrigin).protocol !== "https:") throw new Error("Invalid authentication configuration");
  const now = config.now || Date.now;
  const credentialKey = digest(config.username + "\0" + config.passwordHash);
  const db = new Database(config.databasePath, { create: true, strict: true });
  db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
  db.exec(`CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, credential_key TEXT NOT NULL,
    expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
  ); CREATE TABLE IF NOT EXISTS attempts (
    client_key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL
  ); CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);`);
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
  function authenticated(request: Request): boolean {
    clean();
    const token = sessionToken(request);
    if (!token) return false;
    return !!db.query("SELECT 1 FROM sessions WHERE token_hash = ? AND credential_key = ? AND expires_at > ?").get(digest(token), credentialKey, now());
  }
  function revoke(request: Request) {
    const token = sessionToken(request);
    if (token) db.query("DELETE FROM sessions WHERE token_hash = ?").run(digest(token));
  }
  function attempt(key: string) {
    db.query(`INSERT INTO attempts (client_key, count, expires_at) VALUES (?, 1, ?)
      ON CONFLICT(client_key) DO UPDATE SET count = count + 1`).run(key, now() + WINDOW);
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
      if (path === "/_internal/check" && request.method === "GET") return authenticated(request) ? json({ ok: true }) : unauthorized();
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
        const valid = authenticated(request);
        return json(valid ? { authenticated: true, username: config.username } : { authenticated: false });
      }
      if (path === "/auth/startup-report") {
        if (request.method !== "POST") return json({ ok: false }, 405, { Allow: "POST" });
        if (request.headers.get("Origin") !== config.publicOrigin) return json({ ok: false }, 403);
        // A diagnostic refusal must not activate the workspace's login redirect interceptor.
        if (!authenticated(request)) return json({ ok: false }, 401);
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
  const app = createAuthApp({ ...stored, databasePath: process.env.OPENBOT_AUTH_DB || "/auth-data/sessions.sqlite" });
  const server = Bun.serve({ hostname: "127.0.0.1", port: Number(process.env.OPENBOT_AUTH_PORT || 3002), maxRequestBodySize: 4096, fetch: app.fetch });
  console.log("ChisaBot web authentication listening on loopback");
  const stop = () => { server.stop(true); app.close(); process.exit(0); };
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
}
