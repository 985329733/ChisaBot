"use strict";
/**
 * 登录与设备登记（docs/pc-node.md §4）。
 *
 * 1. 账号密码登录：先试 ChisaBot 网关登录（POST /auth/login，deploy/public 这种带登录网关的部署），
 *    404 时退回 Better Auth（POST /api/auth/sign-in/email）。拿到会话 Cookie。
 * 2. 用会话 Cookie 调 POST /api/devices/enroll，拿到这台电脑专属、可撤销的设备令牌（只返回一次）。
 * 会话 Cookie 之后只用于聊天窗口；节点连接只用设备令牌。
 */

function normalizeServerUrl(input) {
  let text = String(input || "").trim();
  if (!text) throw new Error("请填写服务器地址。");
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`;
  const url = new URL(text);
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname))
    throw new Error("服务器地址必须是 https（本机测试可以用 http://localhost）。");
  if (url.username || url.password) throw new Error("服务器地址里不能包含账号密码。");
  return url.origin;
}

function parseSetCookies(headers) {
  const list = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  const cookies = [];
  for (const line of list) {
    const [pair, ...attrs] = line.split(";");
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    const cookie = { name, value };
    for (const attr of attrs) {
      const [k, v] = attr.trim().split("=");
      const key = k.toLowerCase();
      if (key === "max-age") cookie.maxAge = Number(v);
      if (key === "expires") cookie.expires = Date.parse(v);
      if (key === "httponly") cookie.httpOnly = true;
      if (key === "secure") cookie.secure = true;
      if (key === "path") cookie.path = v;
      if (key === "samesite") cookie.sameSite = (v || "").toLowerCase();
    }
    if (value) cookies.push(cookie);
  }
  return cookies;
}

async function readError(response, fallback) {
  try {
    const body = await response.json();
    return body.error || body.message || fallback;
  } catch {
    return fallback;
  }
}

async function login({ serverUrl, username, password, fetchImpl = fetch }) {
  const origin = normalizeServerUrl(serverUrl);
  if (!username || !password) throw new Error("请填写账号和密码。");
  const headers = { "Content-Type": "application/json", Origin: origin, Accept: "application/json" };
  let response;
  try {
    response = await fetchImpl(`${origin}/auth/login`, {
      method: "POST",
      headers,
      body: JSON.stringify({ username, password, remember: true }),
      redirect: "manual",
    });
  } catch (error) {
    throw new Error(`无法连接服务器：${error.cause?.code || error.message}`);
  }
  let mode = "gateway";
  if (response.status === 404 || response.status === 405) {
    mode = "better-auth";
    response = await fetchImpl(`${origin}/api/auth/sign-in/email`, {
      method: "POST",
      headers,
      body: JSON.stringify({ email: username, password, rememberMe: true }),
      redirect: "manual",
    });
  }
  if (response.status === 429) throw new Error(await readError(response, "尝试次数过多，请稍后再试。"));
  if (!response.ok) throw new Error(await readError(response, "账号或密码不正确。"));
  const cookies = parseSetCookies(response.headers);
  if (!cookies.length) throw new Error("登录成功但服务器没有返回会话，请检查服务器地址。");
  return { origin, mode, cookies, cookieHeader: cookies.map((c) => `${c.name}=${c.value}`).join("; ") };
}

async function enroll({ serverUrl, cookieHeader, info, fetchImpl = fetch }) {
  const origin = normalizeServerUrl(serverUrl);
  const response = await fetchImpl(`${origin}/api/devices/enroll`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      Accept: "application/json",
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
    body: JSON.stringify(info || {}),
    redirect: "manual",
  });
  if (response.status === 401) throw new Error("登录已失效，请重新登录。");
  if (response.status === 404) throw new Error("这台服务器的 ChisaBot 版本还不支持 PC 设备，请先升级服务器。");
  if (!response.ok) throw new Error(await readError(response, `登记设备失败（${response.status}）。`));
  const body = await response.json();
  if (!body.token || !body.device) throw new Error("服务器返回的登记结果无效。");
  return body;
}

async function checkToken({ serverUrl, token, fetchImpl = fetch }) {
  const origin = normalizeServerUrl(serverUrl);
  const response = await fetchImpl(`${origin}/api/devices/agent/self`, {
    headers: { "X-Device-Token": token, Origin: origin, Accept: "application/json" },
  });
  if (response.status === 401) {
    const body = await response.json().catch(() => ({}));
    return { ok: false, revoked: body.revoked === true, invalid: body.revoked !== true };
  }
  if (!response.ok) return { ok: false, status: response.status };
  return { ok: true, device: (await response.json()).device };
}

async function unenroll({ serverUrl, token, fetchImpl = fetch }) {
  const origin = normalizeServerUrl(serverUrl);
  const response = await fetchImpl(`${origin}/api/devices/agent/unenroll`, {
    method: "POST",
    headers: { "X-Device-Token": token, Origin: origin, Accept: "application/json" },
  });
  return response.ok;
}

module.exports = { normalizeServerUrl, parseSetCookies, login, enroll, checkToken, unenroll };
