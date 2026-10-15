import { Database } from "bun:sqlite";
import { beforeAll, describe, expect, test } from "bun:test";
import { createHash, createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAuthApp, signIdentity } from "./server";

// 签名身份 + 单用户（2026-10-15 去掉朋友账号 / 邀请；ADR-0011 作废）。
const origin = "https://chisabot.example.com:8443";
const secret = "test-identity-secret-0123456789abcdef";
const adminPassword = "admin-password-only-for-tests";
let passwordHash: string;
beforeAll(async () => {
  passwordHash = await Bun.password.hash(adminPassword, { algorithm: "argon2id", memoryCost: 4096, timeCost: 1 });
});

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
function app(options: { signed?: boolean; appFetch?: Fetcher; databasePath?: string } = {}) {
  return createAuthApp({
    databasePath: options.databasePath || ":memory:",
    username: "Ayase",
    passwordHash,
    publicOrigin: origin,
    ...(options.signed === false ? {} : { identitySecret: secret }),
    ...(options.appFetch ? { appFetch: options.appFetch } : {}),
  });
}
function req(path: string, init: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> } = {}) {
  const method = init.method || (init.body === undefined ? "GET" : "POST");
  const headers: Record<string, string> = { ...(init.headers || {}) };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET") headers.Origin = origin;
  if (init.cookie) headers.Cookie = init.cookie;
  return new Request(origin + path, { method, headers, ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }) });
}
const cookieOf = (response: Response) => response.headers.get("Set-Cookie")!.split(";")[0]!;
async function adminCookie(service: ReturnType<typeof app>, username = "Ayase") {
  const response = await service.fetch(req("/auth/login", { body: { username, password: adminPassword } }));
  expect(response.status).toBe(200);
  return cookieOf(response);
}
function decode(identity: string) {
  const [, payload] = identity.split(".");
  return JSON.parse(Buffer.from(payload!, "base64url").toString("utf8"));
}

describe("signed identity", () => {
  test("format matches the app's verifier: v1.payload.hmac", () => {
    const value = signIdentity(secret, { id: "dev-local-user", name: "Ayase", role: "admin" }, 1000);
    const [v, payload, mac] = value.split(".");
    expect(v).toBe("v1");
    expect(mac).toBe(createHmac("sha256", secret).update(`v1.${payload}`).digest("base64url"));
    expect(decode(value)).toEqual({ u: "dev-local-user", n: "Ayase", r: "admin", t: 1000 });
  });
  test("admin check carries the built-in admin identity (dev-local-user)", async () => {
    const service = app();
    const admin = await adminCookie(service);
    const check = await service.fetch(req("/_internal/check", { cookie: admin }));
    expect(check.status).toBe(200);
    expect(decode(check.headers.get("X-ChisaBot-Identity")!)).toMatchObject({ u: "dev-local-user", r: "admin" });
    service.close();
  });
  test("without identitySecret no identity header is sent", async () => {
    const service = app({ signed: false });
    const check = await service.fetch(req("/_internal/check", { cookie: await adminCookie(service) }));
    expect(check.status).toBe(200);
    expect(check.headers.get("X-ChisaBot-Identity")).toBeNull();
    service.close();
  });
  test("rejects a short identitySecret", () => {
    expect(() => createAuthApp({ databasePath: ":memory:", username: "a", passwordHash, publicOrigin: origin, identitySecret: "short" })).toThrow();
  });
});

describe("single user", () => {
  test("the admin name is case-insensitive", async () => {
    const service = app();
    await adminCookie(service, "ayase");
    service.close();
  });
  test("account admin API and invite links are gone", async () => {
    const service = app();
    const admin = await adminCookie(service);
    for (const [path, init] of [
      ["/auth/admin/accounts", { cookie: admin }],
      ["/auth/admin/invites", { body: { hours: 24 }, cookie: admin }],
      ["/auth/invite?token=cbi_" + "a".repeat(43), {}],
      ["/auth/invite", { body: { token: "cbi_" + "a".repeat(43), username: "x1", password: "password-123" } }],
    ] as const) expect((await service.fetch(req(path, init))).status).toBe(404);
    service.close();
  });
  test("a phone not owned by the admin gets no session", async () => {
    let owner = "dev-local-user";
    const appFetch: Fetcher = async (url) => {
      if (url.endsWith("/api/devices/agent/session")) return Response.json({ device: { id: "dev_phone", name: "手机", ownerUserId: owner } });
      return Response.json({ active: true });
    };
    const service = app({ appFetch });
    const phone = () => service.fetch(req("/auth/device-session", { body: {}, headers: { "X-Device-Token": "cbd_" + "a".repeat(43) } }));
    const response = await phone();
    expect(response.status).toBe(200);
    const check = await service.fetch(req("/_internal/check", { cookie: cookieOf(response) }));
    expect(decode(check.headers.get("X-ChisaBot-Identity")!).u).toBe("dev-local-user");
    owner = "u_friend123456";
    expect((await phone()).status).toBe(401);
    service.close();
  });
  test("an old multi-account database: admin sessions survive, leftover friend sessions stop working", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cb-identity-"));
    const file = join(dir, "s.sqlite");
    let service = app({ databasePath: file });
    const admin = await adminCookie(service);
    service.close();
    // 模拟以前朋友账号留下的表和会话。
    const db = new Database(file);
    db.exec("CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, username TEXT, username_key TEXT, display_name TEXT, password_hash TEXT, role TEXT, disabled INTEGER, created_at INTEGER, updated_at INTEGER, last_login_at INTEGER)");
    const friendToken = "f".repeat(43);
    db.query("INSERT INTO sessions (token_hash, credential_key, expires_at, created_at, user_id) VALUES (?, 'x', ?, ?, 'u_friend123456')").run(createHash("sha256").update(friendToken).digest("hex"), Date.now() + 3600_000, Date.now());
    db.close();
    service = app({ databasePath: file });
    expect((await service.fetch(req("/_internal/check", { cookie: admin }))).status).toBe(200);
    expect((await service.fetch(req("/_internal/check", { cookie: `__Host-openbot_session=${friendToken}` }))).status).toBe(401);
    service.close();
    const after = new Database(file, { readonly: true });
    expect((after.query("SELECT count(*) AS n FROM sessions WHERE user_id IS NOT NULL").get() as { n: number }).n).toBe(0);
    // 表留着（不删数据表）。
    expect(after.query("SELECT name FROM sqlite_master WHERE name = 'accounts'").get()).not.toBeNull();
    after.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
