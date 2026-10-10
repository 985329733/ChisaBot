import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createAuthApp, safeNext } from "./server";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const origin = "https://chisabot.example.com:8443";
const password = "test-password-only-not-a-real-credential";
let passwordHash: string;
const directory = mkdtempSync(join(tmpdir(), "openbot-auth-test-"));
beforeAll(async () => {
  passwordHash = await Bun.password.hash(password, { algorithm: "argon2id", memoryCost: 4096, timeCost: 1 });
});
afterAll(() => rmSync(directory, { recursive: true, force: true }));

function app(file = ":memory:", now?: () => number) {
  return createAuthApp({ databasePath: file, username: "admin", passwordHash, publicOrigin: origin, now });
}
function request(path: string, body?: unknown, cookie?: string, extra: Record<string, string> = {}) {
  return new Request(origin + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json", Origin: origin }), ...(cookie ? { Cookie: cookie } : {}), ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function cookie(response: Response) { return response.headers.get("Set-Cookie")!.split(";")[0]!; }
async function login(service: ReturnType<typeof app>, remember = false, previous?: string) {
  return service.fetch(request("/auth/login", { username: "admin", password, remember, next: "/channel/demo?hello=1" }, previous));
}

describe("public cookie login", () => {
  test("anonymous API denies access without a browser challenge", async () => {
    const service = app();
    const response = await service.fetch(request("/_internal/check"));
    expect(response.status).toBe(401);
    expect(response.headers.has("WWW-Authenticate")).toBe(false);
    expect((await response.json()).openbotAuthRequired).toBe(true);
    expect((await (await service.fetch(request("/auth/session"))).json()).authenticated).toBe(false);
    service.close();
  });
  test("wrong username and password receive the same generic error", async () => {
    const service = app();
    const a = await service.fetch(request("/auth/login", { username: "admin", password: "incorrect" }));
    const b = await service.fetch(request("/auth/login", { username: "someone", password }));
    expect(a.status).toBe(401); expect(b.status).toBe(401);
    expect(await a.json()).toEqual(await b.json());
    expect(a.headers.has("Set-Cookie")).toBe(false);
    service.close();
  });
  test("login sets safe session cookie and returns original relative destination", async () => {
    const service = app();
    const response = await login(service);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, next: "/channel/demo?hello=1" });
    const header = response.headers.get("Set-Cookie")!;
    expect(header).toMatch(/^__Host-openbot_session=[A-Za-z0-9_-]{43};/);
    for (const attribute of ["Path=/", "Secure", "HttpOnly", "SameSite=Lax"]) expect(header).toContain(attribute);
    expect(header).not.toContain("Domain="); expect(header).not.toContain("Max-Age=");
    const token = cookie(response);
    expect((await service.fetch(request("/_internal/check", undefined, token))).status).toBe(200);
    expect(await (await service.fetch(request("/auth/session", undefined, token))).json()).toMatchObject({ authenticated: true, username: "admin" });
    service.close();
  });
  test("remember login survives restart, expires after30days, and logout revokes copied cookie", async () => {
    let time = 1_000_000;
    const file = join(directory, "persist.sqlite");
    let service = app(file, () => time);
    const response = await login(service, true);
    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=2592000");
    const token = cookie(response); service.close();
    service = app(file, () => time);
    expect((await service.fetch(request("/_internal/check", undefined, token))).status).toBe(200);
    const logout = await service.fetch(request("/auth/logout", {}, token));
    expect(logout.status).toBe(200); expect(logout.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect((await service.fetch(request("/_internal/check", undefined, token))).status).toBe(401);
    const again = cookie(await login(service, true));
    time += 30 * 24 * 3600 * 1000 + 1;
    expect((await service.fetch(request("/_internal/check", undefined, again))).status).toBe(401);
    service.close();
  });
  test("default expiry is12hours and login rotates previous token", async () => {
    let time = 1_000_000; const service = app(":memory:", () => time);
    const first = cookie(await login(service)); const second = cookie(await login(service, false, first));
    expect(second).not.toBe(first);
    expect((await service.fetch(request("/_internal/check", undefined, first))).status).toBe(401);
    time += 12 * 3600 * 1000 + 1;
    expect((await service.fetch(request("/_internal/check", undefined, second))).status).toBe(401);
    service.close();
  });
  test("login and logout reject cross-site, missing Origin, and nonJSON requests", async () => {
    const service = app();
    for (const path of ["/auth/login", "/auth/logout"]) {
      for (const headers of [{ Origin: "https://evil.example" }, { Origin: "null" }, { Origin: "" }, { "Content-Type": "text/plain" }]) {
        const response = await service.fetch(request(path, { username: "admin", password }, undefined, headers));
        expect([403, 415]).toContain(response.status);
        expect(response.headers.has("Set-Cookie")).toBe(false);
      }
    }
    service.close();
  });
  test("failed logins throttle a client and recover after15minutes", async () => {
    let time = 100_000; const service = app(":memory:", () => time);
    for (let i = 0; i < 10; i++) expect((await service.fetch(request("/auth/login", { username: "admin", password: "wrong" }))).status).toBe(401);
    const blocked = await login(service); expect(blocked.status).toBe(429);
    expect(blocked.headers.has("Retry-After")).toBe(true);
    time += 15 * 60 * 1000 + 1;
    expect((await login(service)).status).toBe(200);
    service.close();
  });
  test("existing app's empty-body logout still revokes the gateway session", async () => {
    const service = app(); const token = cookie(await login(service));
    const response = await service.fetch(new Request(origin + "/auth/logout", { method: "POST", headers: { Origin: origin, Cookie: token } }));
    expect(response.status).toBe(200);
    expect((await service.fetch(request("/_internal/check", undefined, token))).status).toBe(401);
    service.close();
  });
  test("tampered cookies, duplicate session names, and credential changes do not authenticate", async () => {
    const file = join(directory, "change.sqlite"); let service = app(file);
    const token = cookie(await login(service));
    expect((await service.fetch(request("/_internal/check", undefined, token + "x"))).status).toBe(401);
    expect((await service.fetch(request("/_internal/check", undefined, token + "; " + token))).status).toBe(401);
    service.close();
    service = createAuthApp({ databasePath: file, username: "admin", publicOrigin: origin, passwordHash: await Bun.password.hash("changed", { algorithm: "argon2id", memoryCost: 4096, timeCost: 1 }) });
    expect((await service.fetch(request("/_internal/check", undefined, token))).status).toBe(401);
    service.close();
  });
  test("redirects cannot leave the site or return to an auth route", () => {
    for (const target of ["https://evil.example", "//evil.example", "/\\evil", "/%2f%2fevil", "/%252f%252fevil", "/%5cevil", "/foo\nbar", "/login", "/auth/logout", "/x/../login", "/sign", null]) expect(safeNext(target)).toBe("/");
    expect(safeNext("/channel/a?hello=1#message")).toBe("/channel/a?hello=1#message");
  });
  test("anonymous navigation has encoded safe return path while API stays JSON401", async () => {
    const service = app();
    const nav = await service.fetch(request("/_internal/unauthorized", undefined, undefined, { Accept: "text/html", "X-Original-URI": "/channel/a?hello=1", "X-Original-Method": "GET", "X-Original-Fetch-Mode": "navigate" }));
    expect(nav.status).toBe(302); expect(nav.headers.get("Location")).toBe("/login?next=%2Fchannel%2Fa%3Fhello%3D1");
    const api = await service.fetch(request("/_internal/unauthorized", undefined, undefined, { "X-Original-URI": "/api/me", "X-Original-Method": "GET" }));
    expect(api.status).toBe(401); expect((await api.json()).openbotAuthRequired).toBe(true);
    service.close();
  });
});
