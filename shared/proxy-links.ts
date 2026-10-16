/**
 * 「Claude 上游代理」的节点分享链接（docs/cloud-claude-code.md「节点链接（sing-box 转换）」，DESIGN.md §84）。
 *
 * 支持 trojan:// · vless:// · vmess://（base64 JSON）· ss://（SIP002 + 旧式整段 base64）· hysteria2:// / hy2:// · tuic://。
 * 服务器用这里把链接解析成 sing-box 的出站配置（toSingBoxOutbound）发给云端节点；节点在容器里起 sing-box，
 * 开一个只听 127.0.0.1、带随机账号密码的 socks5 入站，本机转发器把 Claude 的流量交给它。
 * 网页用这里认出链接类型、显示打码后的 协议 · 主机:端口 · 节点名。
 *
 * 只做纯解析，不碰网络。浏览器、Bun 都能跑（没有 Buffer）。
 */

export type ShareProtocol = "trojan" | "vless" | "vmess" | "shadowsocks" | "hysteria2" | "tuic";

export const SHARE_PROTOCOL_ZH: Record<ShareProtocol, string> = {
  trojan: "Trojan",
  vless: "VLESS",
  vmess: "VMess",
  shadowsocks: "Shadowsocks",
  hysteria2: "Hysteria2",
  tuic: "TUIC",
};

/** 链接开头（小写）→ 协议。 */
const SCHEMES: Record<string, ShareProtocol> = {
  trojan: "trojan",
  vless: "vless",
  vmess: "vmess",
  ss: "shadowsocks",
  hysteria2: "hysteria2",
  hy2: "hysteria2",
  tuic: "tuic",
};

export type ShareTls = {
  enabled: boolean;
  serverName: string | null;
  insecure: boolean;
  alpn: string[];
  fingerprint: string | null;
  reality: { publicKey: string; shortId: string } | null;
};

export type ShareTransport =
  | { type: "tcp" }
  | { type: "ws"; path: string; host: string | null; maxEarlyData: number; earlyDataHeader: string | null }
  | { type: "grpc"; serviceName: string }
  | { type: "http"; path: string; host: string[] }
  | { type: "httpupgrade"; path: string; host: string | null };

export type ShareLink = {
  protocol: ShareProtocol;
  host: string;
  port: number;
  name: string | null;
  /** trojan / ss / hysteria2 / tuic 的密码；vless / vmess / tuic 的 uuid 在 uuid。 */
  password: string | null;
  uuid: string | null;
  tls: ShareTls | null;
  transport: ShareTransport;
  /** vless */
  flow: string | null;
  /** vmess */
  alterId: number;
  security: string | null;
  /** shadowsocks */
  method: string | null;
  /** hysteria2 */
  obfs: { type: "salamander"; password: string } | null;
  upMbps: number | null;
  downMbps: number | null;
  /** tuic */
  congestion: string | null;
  udpRelayMode: string | null;
};

export type ShareParse = { ok: true; link: ShareLink } | { ok: false; error: string };

/** 只看开头：是不是节点分享链接（不管写得对不对）。 */
export function shareScheme(text: string): ShareProtocol | null {
  const m = /^\s*([a-z0-9]+):\/\//i.exec(String(text ?? ""));
  return m ? (SCHEMES[m[1]!.toLowerCase()] ?? null) : null;
}

const SS_METHODS = new Set([
  "2022-blake3-aes-128-gcm",
  "2022-blake3-aes-256-gcm",
  "2022-blake3-chacha20-poly1305",
  "aes-128-gcm",
  "aes-192-gcm",
  "aes-256-gcm",
  "chacha20-ietf-poly1305",
  "xchacha20-ietf-poly1305",
  "aes-128-ctr",
  "aes-192-ctr",
  "aes-256-ctr",
  "aes-128-cfb",
  "aes-192-cfb",
  "aes-256-cfb",
  "rc4-md5",
  "chacha20-ietf",
  "xchacha20",
  "none",
]);
const VMESS_SECURITY = new Set(["auto", "none", "zero", "aes-128-gcm", "chacha20-poly1305", "aes-128-ctr"]);
const FINGERPRINTS = new Set(["chrome", "firefox", "edge", "safari", "360", "qq", "ios", "android", "random", "randomized"]);

function fail(error: string): ShareParse {
  return { ok: false, error };
}

/** 宽松的 base64 解码（标准 / URL 安全、缺 =、带空白），按 UTF-8 解成字符串；不是 base64 返回 null。 */
export function decodeBase64(text: string): string | null {
  let s = String(text ?? "").replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!s || /[^A-Za-z0-9+/=]/.test(s)) return null;
  s = s.replace(/=+$/, "");
  if (s.length % 4 === 1) return null;
  s += "=".repeat((4 - (s.length % 4)) % 4);
  try {
    const bin = atob(s);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function decodeComponent(text: string): string {
  try {
    return decodeURIComponent(text.replace(/\+/g, "%20"));
  } catch {
    return text;
  }
}

/** #后面的节点名（url 编码 / 中文 / emoji 都可以），去掉控制字符，最多 80 字。 */
function nodeName(hash: string): string | null {
  const raw = hash.replace(/^#/, "");
  if (!raw) return null;
  let name: string;
  try {
    name = decodeURIComponent(raw);
  } catch {
    name = raw;
  }
  name = name.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return name ? Array.from(name).slice(0, 80).join("") : null;
}

function validPort(text: string | number | undefined | null): number | null {
  const s = String(text ?? "").trim();
  if (!/^\d{1,5}$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= 65535 ? n : null;
}

function cleanHost(host: string): string | null {
  const h = String(host ?? "").trim().replace(/^\[|\]$/g, "");
  if (!h || h.length > 253 || /[\s/@?#]/.test(h)) return null;
  return h;
}

/** 链接的 主机:端口 / 用户信息 / 参数 / 节点名。主机支持 [IPv6]。 */
type Parts = { userinfo: string | null; host: string; portText: string; params: URLSearchParams; name: string | null; path: string };

function splitAuthority(text: string): Parts | null {
  const m = /^[a-z0-9]+:\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/is.exec(text);
  if (!m) return null;
  const authority = m[1] ?? "";
  const at = authority.lastIndexOf("@");
  const userinfo = at >= 0 ? authority.slice(0, at) : null;
  const hostport = at >= 0 ? authority.slice(at + 1) : authority;
  let host: string;
  let portText: string;
  const v6 = /^\[([^\]]+)\](?::(.*))?$/.exec(hostport);
  if (v6) {
    host = v6[1]!;
    portText = v6[2] ?? "";
  } else {
    const i = hostport.lastIndexOf(":");
    if (i < 0) {
      host = hostport;
      portText = "";
    } else {
      host = hostport.slice(0, i);
      portText = hostport.slice(i + 1);
    }
  }
  return { userinfo, host, portText, params: new URLSearchParams((m[3] ?? "").replace(/^\?/, "")), name: nodeName(m[4] ?? ""), path: m[2] ?? "" };
}

function truthy(v: string | null) {
  return v !== null && ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());
}

function alpnList(v: string | null | undefined): string[] {
  return String(v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function fingerprint(v: string | null | undefined): string | null {
  const f = String(v ?? "").trim().toLowerCase();
  return f && FINGERPRINTS.has(f) ? f : null;
}

/** ws 路径里的 ?ed=2048（Xray 的 0-RTT 写法）→ sing-box 的 max_early_data。 */
function wsPath(rawPath: string): { path: string; maxEarlyData: number; earlyDataHeader: string | null } {
  let path = rawPath || "/";
  if (!path.startsWith("/")) path = `/${path}`;
  const q = path.indexOf("?");
  if (q >= 0) {
    const sp = new URLSearchParams(path.slice(q + 1));
    const ed = Number(sp.get("ed"));
    if (Number.isInteger(ed) && ed > 0) {
      sp.delete("ed");
      const rest = sp.toString();
      return { path: path.slice(0, q) + (rest ? `?${rest}` : ""), maxEarlyData: Math.min(ed, 65535), earlyDataHeader: "Sec-WebSocket-Protocol" };
    }
  }
  return { path, maxEarlyData: 0, earlyDataHeader: null };
}

function transportOf(type: string | null, get: (k: string) => string | null): ShareTransport | string {
  const t = String(type ?? "tcp").trim().toLowerCase() || "tcp";
  const host = (get("host") ?? "").trim() || null;
  const path = get("path") ?? "";
  if (t === "tcp" || t === "raw") {
    const header = (get("headerType") ?? "none").trim().toLowerCase();
    if (header && header !== "none") return "不支持 tcp 的 http 伪装（headerType=http），换一个节点";
    return { type: "tcp" };
  }
  if (t === "ws" || t === "websocket") return { type: "ws", host, ...wsPath(path) };
  if (t === "grpc") return { type: "grpc", serviceName: (get("serviceName") ?? get("path") ?? "").trim() };
  if (t === "h2" || t === "http") return { type: "http", path: path || "/", host: host ? host.split(",").map((s) => s.trim()).filter(Boolean) : [] };
  if (t === "httpupgrade") return { type: "httpupgrade", path: path || "/", host };
  if (t === "xhttp" || t === "splithttp") return "不支持 xhttp 传输，换一个节点";
  if (t === "kcp" || t === "mkcp" || t === "quic") return `不支持 ${t} 传输，换一个节点`;
  return `不认识的传输方式「${t.slice(0, 20)}」`;
}

function emptyLink(protocol: ShareProtocol, host: string, port: number, name: string | null): ShareLink {
  return {
    protocol,
    host,
    port,
    name,
    password: null,
    uuid: null,
    tls: null,
    transport: { type: "tcp" },
    flow: null,
    alterId: 0,
    security: null,
    method: null,
    obfs: null,
    upMbps: null,
    downMbps: null,
    congestion: null,
    udpRelayMode: null,
  };
}

function hostPort(parts: Parts, label: string): { host: string; port: number } | string {
  const host = cleanHost(parts.host);
  if (!host) return `${label} 链接里没有服务器地址`;
  if (/[,-]/.test(parts.portText)) return "不支持多端口（端口跳跃），写一个端口";
  const port = validPort(parts.portText);
  if (!port) return `${label} 链接里的端口不对`;
  return { host, port };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseTrojanVless(text: string, protocol: "trojan" | "vless"): ShareParse {
  const label = protocol === "trojan" ? "Trojan" : "VLESS";
  const parts = splitAuthority(text);
  if (!parts) return fail(`${label} 链接格式不对`);
  const hp = hostPort(parts, label);
  if (typeof hp === "string") return fail(hp);
  const secret = parts.userinfo === null ? "" : decodeComponent(parts.userinfo);
  if (!secret) return fail(protocol === "trojan" ? "Trojan 链接里没有密码" : "VLESS 链接里没有 UUID");
  const link = emptyLink(protocol, hp.host, hp.port, parts.name);
  const p = parts.params;
  const get = (k: string) => p.get(k);
  if (protocol === "trojan") link.password = secret;
  else {
    if (!UUID_RE.test(secret)) return fail("VLESS 链接里的 UUID 不对");
    link.uuid = secret.toLowerCase();
    const enc = (get("encryption") ?? "none").trim().toLowerCase();
    if (enc && enc !== "none") return fail("不支持 VLESS 加密（encryption 不是 none）");
    const flow = (get("flow") ?? "").trim();
    if (flow && flow !== "xtls-rprx-vision") return fail(`不支持 flow「${flow.slice(0, 30)}」`);
    link.flow = flow || null;
  }
  const security = (get("security") ?? (protocol === "trojan" ? "tls" : "none")).trim().toLowerCase() || (protocol === "trojan" ? "tls" : "none");
  if (!["tls", "reality", "none", "xtls"].includes(security)) return fail(`不认识的 security「${security.slice(0, 20)}」`);
  if (security === "reality" && protocol !== "vless") return fail("Reality 只支持 VLESS");
  if (security !== "none") {
    const sni = (get("sni") ?? get("peer") ?? get("host") ?? "").trim() || null;
    link.tls = {
      enabled: true,
      serverName: sni,
      insecure: truthy(get("allowInsecure")) || truthy(get("insecure")) || truthy(get("allow_insecure")),
      alpn: alpnList(get("alpn")),
      fingerprint: fingerprint(get("fp")),
      reality: null,
    };
    if (security === "reality") {
      const pbk = (get("pbk") ?? get("publicKey") ?? "").trim();
      if (!/^[A-Za-z0-9_-]{40,50}$/.test(pbk)) return fail("Reality 链接里没有公钥（pbk）或格式不对");
      const sid = (get("sid") ?? get("shortId") ?? "").trim();
      if (sid && !/^[0-9a-f]{1,16}$/i.test(sid)) return fail("Reality 的 short id（sid）不对");
      if (!link.tls.serverName) return fail("Reality 链接里没有 sni");
      link.tls.reality = { publicKey: pbk, shortId: sid.toLowerCase() };
      link.tls.insecure = false;
      link.tls.fingerprint ??= "chrome";
    }
  }
  const tr = transportOf(get("type"), get);
  if (typeof tr === "string") return fail(tr);
  link.transport = tr;
  if (link.flow && tr.type !== "tcp") return fail("xtls-rprx-vision 只能配 tcp 传输");
  return { ok: true, link };
}

function parseVmess(text: string): ShareParse {
  const body = text.replace(/^\s*vmess:\/\//i, "").split("#")[0]!.trim();
  const json = decodeBase64(decodeComponent(body));
  if (!json) return fail("VMess 链接不是 base64 的 JSON（只支持 v2rayN 格式）");
  let v: Record<string, unknown>;
  try {
    v = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return fail("VMess 链接里的 JSON 不对");
  }
  if (!v || typeof v !== "object") return fail("VMess 链接里的 JSON 不对");
  const s = (k: string) => (v[k] === undefined || v[k] === null ? "" : String(v[k])).trim();
  const host = cleanHost(s("add"));
  if (!host) return fail("VMess 链接里没有服务器地址");
  const port = validPort(s("port"));
  if (!port) return fail("VMess 链接里的端口不对");
  const id = s("id");
  if (!UUID_RE.test(id)) return fail("VMess 链接里的 UUID 不对");
  const link = emptyLink("vmess", host, port, s("ps") ? Array.from(s("ps").replace(/[\u0000-\u001f\u007f]/g, "")).slice(0, 80).join("") || null : null);
  link.uuid = id.toLowerCase();
  const aid = Number(s("aid") || 0);
  link.alterId = Number.isInteger(aid) && aid >= 0 && aid <= 65535 ? aid : 0;
  const scy = (s("scy") || "auto").toLowerCase();
  if (!VMESS_SECURITY.has(scy)) return fail(`不支持 VMess 加密「${scy.slice(0, 20)}」`);
  link.security = scy;
  const net = s("net") || "tcp";
  const get = (k: string) => {
    if (k === "headerType") return s("type") || null;
    if (k === "serviceName") return s("path") || null;
    const x = s(k);
    return x || null;
  };
  const tr = transportOf(net, get);
  if (typeof tr === "string") return fail(tr);
  link.transport = tr;
  const tls = s("tls").toLowerCase();
  if (tls === "tls") {
    link.tls = {
      enabled: true,
      serverName: s("sni") || s("host").split(",")[0]!.trim() || null,
      insecure: truthy(s("allowInsecure")) || truthy(s("insecure")) || truthy(s("skip-cert-verify")),
      alpn: alpnList(s("alpn")),
      fingerprint: fingerprint(s("fp")),
      reality: null,
    };
  } else if (tls && tls !== "none") return fail(`不支持 VMess 的 tls「${tls.slice(0, 20)}」`);
  return { ok: true, link };
}

function parseShadowsocks(text: string): ShareParse {
  const raw = text.trim();
  const hashAt = raw.indexOf("#");
  const name = hashAt >= 0 ? nodeName(raw.slice(hashAt)) : null;
  let rest = (hashAt >= 0 ? raw.slice(0, hashAt) : raw).replace(/^ss:\/\//i, "");
  let method: string;
  let password: string;
  let hostport: string;
  let params = new URLSearchParams();
  const q = rest.indexOf("?");
  if (q >= 0) {
    params = new URLSearchParams(rest.slice(q + 1));
    rest = rest.slice(0, q);
  }
  rest = rest.replace(/\/+$/, "");
  const at = rest.lastIndexOf("@");
  if (at >= 0) {
    // SIP002：ss://base64(method:password)@host:port 或 ss://method:password@host:port（2022 方法常见，密码 url 编码）
    const user = decodeComponent(rest.slice(0, at));
    hostport = rest.slice(at + 1);
    const decoded = user.includes(":") ? null : decodeBase64(user);
    const pair = decoded ?? user;
    const i = pair.indexOf(":");
    if (i <= 0) return fail("Shadowsocks 链接里没有 加密方式:密码");
    method = pair.slice(0, i);
    password = pair.slice(i + 1);
  } else {
    // 旧式：ss://base64(method:password@host:port)
    const decoded = decodeBase64(decodeComponent(rest));
    if (!decoded) return fail("Shadowsocks 链接格式不对");
    const a = decoded.lastIndexOf("@");
    if (a < 0) return fail("Shadowsocks 链接格式不对");
    const pair = decoded.slice(0, a);
    hostport = decoded.slice(a + 1);
    const i = pair.indexOf(":");
    if (i <= 0) return fail("Shadowsocks 链接里没有 加密方式:密码");
    method = pair.slice(0, i);
    password = pair.slice(i + 1);
  }
  method = method.trim().toLowerCase();
  if (!SS_METHODS.has(method)) return fail(`不支持 Shadowsocks 加密方式「${method.slice(0, 30)}」`);
  if (!password && method !== "none") return fail("Shadowsocks 链接里没有密码");
  if (params.get("plugin")) return fail("不支持带插件（plugin）的 Shadowsocks 节点");
  const parts = splitAuthority(`ss://${hostport}`);
  if (!parts) return fail("Shadowsocks 链接里的服务器地址不对");
  const hp = hostPort(parts, "Shadowsocks");
  if (typeof hp === "string") return fail(hp);
  const link = emptyLink("shadowsocks", hp.host, hp.port, name);
  link.method = method;
  link.password = password;
  return { ok: true, link };
}

function parseHysteria2(text: string): ShareParse {
  const parts = splitAuthority(text);
  if (!parts) return fail("Hysteria2 链接格式不对");
  const hp = hostPort({ ...parts, portText: parts.portText || "443" }, "Hysteria2");
  if (typeof hp === "string") return fail(hp);
  const p = parts.params;
  const auth = parts.userinfo === null ? (p.get("auth") ?? "") : decodeComponent(parts.userinfo);
  if (!auth) return fail("Hysteria2 链接里没有密码");
  const link = emptyLink("hysteria2", hp.host, hp.port, parts.name);
  link.password = auth;
  link.tls = {
    enabled: true,
    serverName: (p.get("sni") ?? p.get("peer") ?? "").trim() || null,
    insecure: truthy(p.get("insecure")) || truthy(p.get("allowInsecure")),
    alpn: alpnList(p.get("alpn")),
    fingerprint: null,
    reality: null,
  };
  const obfs = (p.get("obfs") ?? "").trim().toLowerCase();
  if (obfs && obfs !== "none") {
    if (obfs !== "salamander") return fail(`不支持 Hysteria2 混淆「${obfs.slice(0, 20)}」`);
    const pw = p.get("obfs-password") ?? p.get("obfs_password") ?? "";
    if (!pw) return fail("Hysteria2 的混淆密码（obfs-password）是空的");
    link.obfs = { type: "salamander", password: pw };
  }
  const mbps = (k: string) => {
    const n = Number(String(p.get(k) ?? "").replace(/\s*mbps$/i, ""));
    return Number.isFinite(n) && n > 0 && n < 100000 ? Math.round(n) : null;
  };
  link.upMbps = mbps("up") ?? mbps("upmbps");
  link.downMbps = mbps("down") ?? mbps("downmbps");
  return { ok: true, link };
}

function parseTuic(text: string): ShareParse {
  const parts = splitAuthority(text);
  if (!parts) return fail("TUIC 链接格式不对");
  const hp = hostPort(parts, "TUIC");
  if (typeof hp === "string") return fail(hp);
  const user = parts.userinfo ?? "";
  const i = user.indexOf(":");
  const uuid = decodeComponent(i >= 0 ? user.slice(0, i) : user);
  const password = i >= 0 ? decodeComponent(user.slice(i + 1)) : "";
  if (!UUID_RE.test(uuid)) return fail("TUIC 链接里的 UUID 不对");
  const p = parts.params;
  const link = emptyLink("tuic", hp.host, hp.port, parts.name);
  link.uuid = uuid.toLowerCase();
  link.password = password;
  const cc = (p.get("congestion_control") ?? p.get("congestion") ?? "").trim().toLowerCase();
  if (cc && !["cubic", "new_reno", "bbr"].includes(cc)) return fail(`不支持 TUIC 拥塞控制「${cc.slice(0, 20)}」`);
  link.congestion = cc || null;
  const mode = (p.get("udp_relay_mode") ?? "").trim().toLowerCase();
  link.udpRelayMode = mode === "native" || mode === "quic" ? mode : null;
  link.tls = {
    enabled: true,
    serverName: (p.get("sni") ?? "").trim() || null,
    insecure: truthy(p.get("allow_insecure")) || truthy(p.get("insecure")) || truthy(p.get("allowInsecure")),
    alpn: alpnList(p.get("alpn")),
    fingerprint: null,
    reality: null,
  };
  return { ok: true, link };
}

/** 解析节点分享链接。不是分享链接（或写得不对）返回 { ok: false, error }。 */
export function parseShareLink(text: string): ShareParse {
  const t = String(text ?? "").trim();
  if (t.length > 8000) return fail("链接太长");
  if (/\s/.test(t)) return fail("链接里有空格或换行，一次只填一个节点");
  const proto = shareScheme(t);
  if (!proto) return fail("不是节点链接");
  switch (proto) {
    case "trojan":
      return parseTrojanVless(t, "trojan");
    case "vless":
      return parseTrojanVless(t, "vless");
    case "vmess":
      return parseVmess(t);
    case "shadowsocks":
      return parseShadowsocks(t);
    case "hysteria2":
      return parseHysteria2(t);
    case "tuic":
      return parseTuic(t);
  }
}

/** 给人看的：协议 · 主机:端口 · 节点名（没有密码、UUID）。 */
export function maskShareLink(text: string): string | null {
  const r = parseShareLink(text);
  if (!r.ok) return null;
  const { link } = r;
  const host = link.host.includes(":") ? `[${link.host}]` : link.host;
  return [SHARE_PROTOCOL_ZH[link.protocol], `${host}:${link.port}`, link.name].filter(Boolean).join(" · ");
}

type Json = Record<string, unknown>;

function tlsJson(link: ShareLink): Json | undefined {
  const t = link.tls;
  if (!t || !t.enabled) return undefined;
  const out: Json = { enabled: true, server_name: t.serverName ?? link.host };
  if (t.insecure) out.insecure = true;
  if (t.alpn.length) out.alpn = t.alpn;
  else if (link.protocol === "hysteria2" || link.protocol === "tuic") out.alpn = ["h3"];
  if (t.fingerprint) out.utls = { enabled: true, fingerprint: t.fingerprint };
  if (t.reality) out.reality = { enabled: true, public_key: t.reality.publicKey, short_id: t.reality.shortId };
  return out;
}

function transportJson(tr: ShareTransport): Json | undefined {
  switch (tr.type) {
    case "tcp":
      return undefined;
    case "ws": {
      const out: Json = { type: "ws", path: tr.path };
      if (tr.host) out.headers = { Host: tr.host };
      if (tr.maxEarlyData) {
        out.max_early_data = tr.maxEarlyData;
        out.early_data_header_name = tr.earlyDataHeader ?? "Sec-WebSocket-Protocol";
      }
      return out;
    }
    case "grpc":
      return { type: "grpc", service_name: tr.serviceName };
    case "http":
      return { type: "http", path: tr.path, ...(tr.host.length ? { host: tr.host } : {}) };
    case "httpupgrade":
      return { type: "httpupgrade", path: tr.path, ...(tr.host ? { host: tr.host } : {}) };
  }
}

/**
 * sing-box 1.14 的出站（tag 固定 "up"）。节点会再检查一遍类型、强制 tag，再接到本机 socks5 入站后面。
 * 只用 sing-box 稳定版里有的字段。
 */
export function toSingBoxOutbound(link: ShareLink): Json {
  const base: Json = { tag: "up", server: link.host, server_port: link.port };
  const tls = tlsJson(link);
  const transport = transportJson(link.transport);
  switch (link.protocol) {
    case "trojan":
      return { type: "trojan", ...base, password: link.password, ...(tls ? { tls } : {}), ...(transport ? { transport } : {}) };
    case "vless":
      return { type: "vless", ...base, uuid: link.uuid, ...(link.flow ? { flow: link.flow } : {}), ...(tls ? { tls } : {}), ...(transport ? { transport } : {}) };
    case "vmess":
      return { type: "vmess", ...base, uuid: link.uuid, security: link.security ?? "auto", alter_id: link.alterId, ...(tls ? { tls } : {}), ...(transport ? { transport } : {}) };
    case "shadowsocks":
      return { type: "shadowsocks", ...base, method: link.method, password: link.password };
    case "hysteria2":
      return {
        type: "hysteria2",
        ...base,
        password: link.password,
        ...(link.obfs ? { obfs: { type: "salamander", password: link.obfs.password } } : {}),
        ...(link.upMbps ? { up_mbps: link.upMbps } : {}),
        ...(link.downMbps ? { down_mbps: link.downMbps } : {}),
        tls,
      };
    case "tuic":
      return {
        type: "tuic",
        ...base,
        uuid: link.uuid,
        password: link.password ?? "",
        ...(link.congestion ? { congestion_control: link.congestion } : {}),
        ...(link.udpRelayMode ? { udp_relay_mode: link.udpRelayMode } : {}),
        tls,
      };
  }
}

/** 这条出站里不能回显的值（密码、UUID、混淆密码、reality 公钥不算秘密但也抹掉），节点抹日志用。 */
export function shareSecrets(link: ShareLink): string[] {
  return [link.password, link.uuid, link.obfs?.password].filter((s): s is string => !!s && s.length >= 3);
}
