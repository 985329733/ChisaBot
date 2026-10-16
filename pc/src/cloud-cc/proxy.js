"use strict";
/**
 * 「Claude 上游代理」（docs/cloud-claude-code.md「云端登录与上游代理」）：节点进程里的本机转发器，只听容器自己的 127.0.0.1。
 *
 * - Claude Code CLI（HTTPS_PROXY）和云端登录浏览器（--proxy-server）都连这个转发器。
 * - 转发器按目标主机分流：Claude 的域名（anthropic.com / claude.ai / claude.com 及子域）走你设置的上游代理
 *   （http / https / socks5，可带 user:pass；socks5 由代理解析域名）；其他域名（GitHub、npm…）照旧直连。
 * - 没设上游时 CLI 和浏览器都不经过它（直连，走机房默认出口）。
 * - 上游地址（含密码）只在内存里，不写盘、不进日志；错误信息里抹掉。
 */
const net = require("node:net");
const tls = require("node:tls");
const http = require("node:http");
const https = require("node:https");

const CLAUDE_SUFFIXES = ["anthropic.com", "claude.ai", "claude.com"];

function extraHosts() {
  return String(process.env.CHISABOT_CLAUDE_HOSTS_EXTRA || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function isClaudeHost(host) {
  const h = String(host || "").toLowerCase().replace(/\.$/, "");
  return [...CLAUDE_SUFFIXES, ...extraHosts()].some((s) => h === s || h.endsWith(`.${s}`));
}

/** 解析代理地址；返回 null 表示不对。 */
function parseProxy(text) {
  let u;
  try {
    u = new URL(String(text || "").trim());
  } catch {
    return null;
  }
  const protocol = u.protocol.replace(/:$/, "").toLowerCase();
  if (!["http", "https", "socks5", "socks5h"].includes(protocol)) return null;
  if (!u.hostname || u.pathname.replace(/\/+$/, "") || u.search || u.hash) return null;
  const port = Number(u.port || (protocol === "http" ? 80 : protocol === "https" ? 443 : 1080));
  if (!port || port > 65535) return null;
  return {
    protocol: protocol === "socks5h" ? "socks5" : protocol,
    host: u.hostname.replace(/^\[|\]$/g, ""),
    port,
    username: u.username ? decodeURIComponent(u.username) : "",
    password: u.password ? decodeURIComponent(u.password) : "",
  };
}

/** 给人看的：密码换成 ••••。 */
function maskProxy(text) {
  const p = parseProxy(text);
  if (!p) return null;
  const auth = p.username ? `${encodeURIComponent(p.username)}${p.password ? ":••••" : ""}@` : "";
  const host = p.host.includes(":") ? `[${p.host}]` : p.host;
  return `${p.protocol}://${auth}${host}:${p.port}`;
}

function scrubProxy(message, p) {
  let t = String(message || "");
  if (p && p.password) t = t.split(p.password).join("••••");
  if (p && p.username && p.username.length > 3) t = t.split(p.username).join("•••");
  return t.slice(0, 400);
}

function once(socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("代理响应超时")), timeoutMs);
    socket.once("data", (d) => {
      clearTimeout(timer);
      resolve(d);
    });
    socket.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    socket.once("close", () => {
      clearTimeout(timer);
      reject(new Error("代理断开了连接"));
    });
  });
}

/** 读到 \r\n\r\n 为止（HTTP CONNECT 的回应）。 */
function readHead(socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => done(new Error("代理响应超时")), timeoutMs);
    const onData = (d) => {
      buf = Buffer.concat([buf, d]);
      const i = buf.indexOf("\r\n\r\n");
      if (i >= 0) {
        const rest = buf.subarray(i + 4);
        done(null, buf.subarray(0, i).toString("latin1"), rest);
      } else if (buf.length > 65536) done(new Error("代理回应太长"));
    };
    const onErr = (e) => done(e);
    const onClose = () => done(new Error("代理断开了连接"));
    function done(err, head, rest) {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onErr);
      socket.off("close", onClose);
      if (err) reject(err);
      else resolve({ head, rest });
    }
    socket.on("data", onData);
    socket.on("error", onErr);
    socket.on("close", onClose);
  });
}

function connectTcp(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const s = net.connect({ host, port });
    const timer = setTimeout(() => {
      s.destroy();
      reject(new Error(`连不上 ${host}:${port}（超时）`));
    }, timeoutMs);
    s.once("connect", () => {
      clearTimeout(timer);
      resolve(s);
    });
    s.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

/** 经上游代理连到 host:port，返回一个原始 TCP 隧道（之后上面跑 TLS 还是明文都可以）。 */
async function tunnel(p, host, port, timeoutMs = 15_000) {
  let s = await connectTcp(p.host, p.port, timeoutMs);
  if (p.protocol === "https") {
    s = await new Promise((resolve, reject) => {
      const t = tls.connect({ socket: s, servername: net.isIP(p.host) ? undefined : p.host });
      t.once("secureConnect", () => resolve(t));
      t.once("error", reject);
    });
  }
  if (p.protocol === "http" || p.protocol === "https") {
    const auth = p.username ? `Proxy-Authorization: Basic ${Buffer.from(`${p.username}:${p.password}`).toString("base64")}\r\n` : "";
    const target = host.includes(":") ? `[${host}]:${port}` : `${host}:${port}`;
    s.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${auth}\r\n`);
    const { head, rest } = await readHead(s, timeoutMs);
    const code = Number(/^HTTP\/1\.[01] (\d{3})/.exec(head)?.[1] || 0);
    if (code !== 200) {
      s.destroy();
      throw new Error(code === 407 ? "上游代理要求认证（用户名或密码不对）" : `上游代理拒绝了连接（${code || "回应不对"}）`);
    }
    if (rest.length) s.unshift(rest);
    return s;
  }
  // socks5（RFC 1928 / 1929），域名交给代理解析
  s.write(Buffer.from(p.username ? [5, 2, 0, 2] : [5, 1, 0]));
  let r = await once(s, timeoutMs);
  if (r[0] !== 5 || r[1] === 0xff) throw new Error("socks5 代理不接受这种认证方式");
  if (r[1] === 2) {
    const u = Buffer.from(p.username);
    const pw = Buffer.from(p.password);
    s.write(Buffer.concat([Buffer.from([1, u.length]), u, Buffer.from([pw.length]), pw]));
    r = await once(s, timeoutMs);
    if (r[1] !== 0) throw new Error("上游代理要求认证（用户名或密码不对）");
  }
  const isIp = net.isIP(host);
  const addr =
    isIp === 4
      ? Buffer.concat([Buffer.from([1]), Buffer.from(host.split(".").map(Number))])
      : Buffer.concat([Buffer.from([3, Buffer.byteLength(host)]), Buffer.from(host)]);
  const portBuf = Buffer.from([port >> 8, port & 255]);
  s.write(Buffer.concat([Buffer.from([5, 1, 0]), addr, portBuf]));
  r = await once(s, timeoutMs);
  if (r[0] !== 5 || r[1] !== 0) {
    s.destroy();
    throw new Error(`socks5 代理拒绝了连接（${r[1]}）`);
  }
  // 回应里的地址长度不定；常见实现一次发完，多出来的放回去
  const atyp = r[3];
  const len = atyp === 1 ? 10 : atyp === 4 ? 22 : 7 + r[4];
  if (r.length > len) s.unshift(r.subarray(len));
  return s;
}

/**
 * 本机转发器。setUpstream(url | null) 随时换；正在用的连接不受影响，新连接用新设置。
 * @returns {{ port: number|null, start(): Promise<number>, setUpstream(u: string|null): void, upstream(): object|null, close(): void, stats: object }}
 */
function createForwarder({ log = () => {} } = {}) {
  let upstream = null;
  let server = null;
  let port = null;
  const stats = { viaUpstream: 0, direct: 0, failed: 0 };

  async function open(host, p) {
    if (upstream && isClaudeHost(host)) {
      stats.viaUpstream++;
      return tunnel(upstream, host, p);
    }
    stats.direct++;
    return connectTcp(host, p, 15_000);
  }

  function start() {
    if (server) return Promise.resolve(port);
    server = http.createServer(async (req, res) => {
      // 明文 http 的绝对地址请求（浏览器打开 http:// 页面时）：按同样规则转
      try {
        const u = new URL(req.url);
        const sock = await open(u.hostname, Number(u.port || 80));
        const headers = { ...req.headers };
        for (const k of Object.keys(headers)) if (/^proxy-/i.test(k)) delete headers[k];
        const up = http.request({ host: u.hostname, port: Number(u.port || 80), path: `${u.pathname}${u.search}`, method: req.method, headers, createConnection: () => sock, agent: false }, (r) => {
          res.writeHead(r.statusCode || 502, r.headers);
          r.pipe(res);
        });
        up.on("error", (e) => {
          stats.failed++;
          if (!res.headersSent) res.writeHead(502);
          res.end(scrubProxy(e.message, upstream));
        });
        req.pipe(up);
      } catch (e) {
        stats.failed++;
        res.writeHead(502);
        res.end(scrubProxy(e.message, upstream));
      }
    });
    server.on("connect", async (req, clientSocket, head) => {
      const m = /^\[?([^\]]+?)\]?:(\d+)$/.exec(req.url || "");
      if (!m) {
        clientSocket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
        return;
      }
      clientSocket.on("error", () => {});
      try {
        const s = await open(m[1], Number(m[2]));
        s.on("error", () => clientSocket.destroy());
        clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head && head.length) s.write(head);
        s.pipe(clientSocket);
        clientSocket.pipe(s);
        clientSocket.on("close", () => s.destroy());
        s.on("close", () => clientSocket.destroy());
      } catch (e) {
        stats.failed++;
        log(`转发失败 ${m[1]}：${scrubProxy(e.message, upstream)}`);
        clientSocket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
      }
    });
    return new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        port = server.address().port;
        resolve(port);
      });
    });
  }

  return {
    get port() {
      return port;
    },
    start,
    setUpstream(text) {
      upstream = text ? parseProxy(text) : null;
    },
    upstream: () => upstream,
    close() {
      if (server) server.close();
      server = null;
    },
    stats,
  };
}

/** 经（或不经）上游代理发一个 HTTPS GET，测试用：返回 { status, body }。 */
function httpsGet(url, p, timeoutMs = 15_000) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("超时")), timeoutMs);
    const finish = (fn, v) => {
      clearTimeout(timer);
      fn(v);
    };
    const go = (sock) => {
      const req = https.request(
        {
          host: u.hostname,
          servername: u.hostname,
          path: `${u.pathname}${u.search}`,
          method: "GET",
          headers: { "user-agent": "ChisaBot-cloudnode/1.0", accept: "*/*" },
          ...(sock ? { createConnection: () => tls.connect({ socket: sock, servername: u.hostname }) } : {}),
          agent: false,
        },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (c) => {
            if (body.length < 8000) body += c;
          });
          res.on("end", () => finish(resolve, { status: res.statusCode, body }));
        },
      );
      req.on("error", (e) => finish(reject, e));
      req.end();
    };
    if (p) tunnel(p, u.hostname, Number(u.port || 443), timeoutMs).then(go, (e) => finish(reject, e));
    else go(null);
  });
}

/** Cloudflare 的 /cdn-cgi/trace 里的 ip=… */
function traceIp(body) {
  const m = /^ip=(.+)$/m.exec(String(body || ""));
  return m ? m[1].trim() : null;
}

/** /cdn-cgi/trace 里的 loc=…（两个字母的国家 / 地区代码）。 */
function traceLoc(body) {
  const m = /^loc=([A-Za-z]{2})$/m.exec(String(body || ""));
  return m ? m[1].toUpperCase() : null;
}

/** 测试连接：出口 IP 和国家（claude.ai 看到的）+ claude.ai / api.anthropic.com 通不通。 */
async function testRoute(text) {
  const p = text ? parseProxy(text) : null;
  if (text && !p) return { ok: false, error: "代理地址不对：写成 http://、https:// 或 socks5://主机:端口，可以带 用户名:密码@" };
  const started = Date.now();
  const out = { ok: false, ip: null, country: null, claudeAi: null, anthropicApi: null, ms: null, error: null };
  try {
    const trace = await httpsGet("https://claude.ai/cdn-cgi/trace", p);
    out.ip = traceIp(trace.body);
    out.country = traceLoc(trace.body);
    out.claudeAi = { ok: trace.status > 0 && trace.status < 500, status: trace.status };
  } catch (e) {
    out.claudeAi = { ok: false, error: scrubProxy(e.message, p) };
  }
  try {
    const api = await httpsGet("https://api.anthropic.com/v1/models", p);
    out.anthropicApi = { ok: api.status > 0 && api.status < 500, status: api.status };
  } catch (e) {
    out.anthropicApi = { ok: false, error: scrubProxy(e.message, p) };
  }
  out.ms = Date.now() - started;
  out.ok = !!(out.claudeAi && out.claudeAi.ok && out.anthropicApi && out.anthropicApi.ok);
  if (!out.ok) out.error = (out.claudeAi && out.claudeAi.error) || (out.anthropicApi && out.anthropicApi.error) || "Claude 的服务器没有正常回应";
  return out;
}

module.exports = { createForwarder, parseProxy, maskProxy, scrubProxy, isClaudeHost, tunnel, httpsGet, traceIp, traceLoc, testRoute };
