"use strict";
/**
 * 「Claude 上游代理」的节点链接转换（docs/cloud-claude-code.md「节点链接（sing-box 转换）」，DESIGN.md §85）。
 *
 * 服务器把 trojan:// / vless:// / vmess:// / ss:// / hysteria2:// / tuic:// 链接解析成 sing-box 出站（shared/proxy-links.ts），
 * 经 cc_rpc proxy_set 发过来；这里在容器里起一个 sing-box 子进程：
 *   - 入站：socks5，只听 127.0.0.1 的随机端口，随机用户名 + 密码（容器里别的进程也连不上没认证的）；
 *   - 出站：服务器给的那一个（tag 固定 up），route.final = up。
 * 本机转发器（proxy.js）把它当成普通的 socks5 上游：Claude 的域名走它，其他照旧直连——和 http / socks5 代理覆盖的流量完全一样。
 *
 * - 配置走标准输入（-c stdin），不落盘；工作目录是 /tmp 下 700 的临时目录。
 * - 进程意外退出：按 1s → 2s → 4s … 30s 退避重启（同一端口、同一份配置），节点进程就是它的看护进程。
 * - 日志只转 warn 以上，转之前抹掉密码 / UUID / 入站密码；限速，免得刷屏。
 * - sing-box 的路径：CHISABOT_SINGBOX（默认 /usr/local/bin/sing-box，云端节点镜像里装的是固定版本、校验过 sha256 的）。
 */
const fs = require("node:fs");
const os = require("node:os");
const net = require("node:net");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn, execFile } = require("node:child_process");

const OUTBOUND_TYPES = new Set(["trojan", "vless", "vmess", "shadowsocks", "hysteria2", "tuic"]);
/** 出站里这些字段由节点决定，服务器给了也去掉（不许绕到别的出站 / 网卡）。 */
const STRIP_KEYS = ["detour", "bind_interface", "inet4_bind_address", "inet6_bind_address", "routing_mark", "netns", "network_strategy", "network_type", "fallback_network_type"];

function singBoxPath() {
  return process.env.CHISABOT_SINGBOX || "/usr/local/bin/sing-box";
}

/** sing-box 在不在、是哪个版本（"1.14.3"）；没有返回 null。 */
function singBoxVersion(bin = singBoxPath()) {
  return new Promise((resolve) => {
    try {
      fs.accessSync(bin, fs.constants.X_OK);
    } catch {
      resolve(null);
      return;
    }
    execFile(bin, ["version"], { timeout: 10_000 }, (err, stdout) => {
      if (err) return resolve(null);
      const m = /sing-box version (\S+)/.exec(String(stdout));
      resolve(m ? m[1] : null);
    });
  });
}

/** 检查并清理服务器给的出站；不对抛错。 */
function cleanOutbound(outbound) {
  if (!outbound || typeof outbound !== "object" || Array.isArray(outbound)) throw new Error("节点配置不对");
  const type = String(outbound.type || "");
  if (!OUTBOUND_TYPES.has(type)) throw new Error(`不支持的节点类型「${type.slice(0, 20)}」`);
  if (!outbound.server || !Number.isInteger(outbound.server_port)) throw new Error("节点配置里没有服务器地址");
  const out = JSON.parse(JSON.stringify(outbound));
  for (const k of STRIP_KEYS) delete out[k];
  out.tag = "up";
  return out;
}

/** 出站里不能进日志的值。 */
function outboundSecrets(outbound) {
  const s = [];
  if (outbound) {
    for (const k of ["password", "uuid"]) if (typeof outbound[k] === "string") s.push(outbound[k]);
    if (outbound.obfs && typeof outbound.obfs.password === "string") s.push(outbound.obfs.password);
  }
  return s.filter((x) => x && x.length >= 3);
}

function scrub(text, secrets) {
  let t = String(text || "").replace(/\x1b\[[0-9;]*m/g, "");
  for (const s of secrets) if (s) t = t.split(s).join("••••");
  return t.slice(0, 300);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function canConnect(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: "127.0.0.1", port });
    const done = (ok) => {
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(500, () => done(false));
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
  });
}

function buildConfig(outbound, port, user, pass) {
  return {
    log: { level: "warn", timestamp: false },
    inbounds: [{ type: "socks", tag: "in", listen: "127.0.0.1", listen_port: port, users: [{ username: user, password: pass }] }],
    outbounds: [outbound],
    route: { final: "up" },
  };
}

/**
 * 一个 sing-box 实例（setUpstream 用一个长期的；测试连接时临时起一个，测完就停）。
 * @param {{ log?: (s: string) => void, bin?: string, supervise?: boolean, name?: string }} opts
 */
function createSingBox({ log = () => {}, bin = singBoxPath(), supervise = true, name = "sing-box" } = {}) {
  let child = null;
  let cfg = null; // { outbound, port, user, pass, secrets }
  let stopped = true;
  let restartTimer = null;
  let backoff = 1000;
  let lastError = null;
  let generation = 0;
  let logBudget = { at: Date.now(), n: 0 };

  function emit(line) {
    const now = Date.now();
    if (now - logBudget.at > 60_000) logBudget = { at: now, n: 0 };
    if (++logBudget.n > 20) return;
    log(`${name}：${scrub(line, cfg ? [...cfg.secrets, cfg.pass] : [])}`);
  }

  function spawnOnce() {
    const gen = generation;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chisabot-singbox-"));
    fs.chmodSync(dir, 0o700);
    const p = spawn(bin, ["run", "--disable-color", "-c", "stdin", "-D", dir], { stdio: ["pipe", "pipe", "pipe"], env: { PATH: process.env.PATH || "/usr/bin:/bin", HOME: dir } });
    p.stdin.on("error", () => {});
    p.stdin.end(JSON.stringify(buildConfig(cfg.outbound, cfg.port, cfg.user, cfg.pass)));
    let tail = "";
    const onData = (d) => {
      const text = String(d);
      tail = (tail + text).slice(-2000);
      for (const line of text.split("\n")) if (line.trim()) emit(line.trim());
    };
    p.stdout.on("data", onData);
    p.stderr.on("data", onData);
    p.on("exit", (code, signal) => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {}
      if (child === p) child = null;
      p.lastOutput = scrub(tail.trim().split("\n").slice(-3).join(" "), cfg ? [...cfg.secrets, cfg.pass] : []);
      if (stopped || gen !== generation) return;
      lastError = `${name} 退出了（${signal || code}）${p.lastOutput ? `：${p.lastOutput}` : ""}`;
      log(`${lastError}，${Math.round(backoff / 1000)} 秒后重启`);
      if (!supervise) return;
      restartTimer = setTimeout(() => {
        restartTimer = null;
        if (stopped || gen !== generation) return;
        child = spawnOnce();
        void waitReady(child, 8000).then(
          () => {
            backoff = 1000;
            lastError = null;
            log(`${name} 已重启`);
          },
          () => {},
        );
      }, backoff);
      backoff = Math.min(backoff * 2, 30_000);
    });
    p.on("error", (e) => {
      lastError = `${name} 启动不了：${e.message}`;
    });
    return p;
  }

  async function waitReady(p, timeoutMs) {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      if (p.exitCode !== null || p.signalCode !== null) {
        await new Promise((r) => setTimeout(r, 50));
        throw new Error(`sing-box 没起来${p.lastOutput ? `：${p.lastOutput}` : ""}`);
      }
      if (await canConnect(cfg.port)) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("sing-box 启动超时");
  }

  async function stop() {
    stopped = true;
    generation++;
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = null;
    const p = child;
    child = null;
    if (p && p.exitCode === null && p.signalCode === null) {
      await new Promise((resolve) => {
        const t = setTimeout(() => {
          try {
            p.kill("SIGKILL");
          } catch {}
          resolve();
        }, 3000);
        p.once("exit", () => {
          clearTimeout(t);
          resolve();
        });
        try {
          p.kill("SIGTERM");
        } catch {
          clearTimeout(t);
          resolve();
        }
      });
    }
  }

  return {
    /** 用这个出站（重启进程）。返回本机 socks5 地址（带随机账号密码，只在内存里）。 */
    async start(outbound) {
      const clean = cleanOutbound(outbound);
      try {
        fs.accessSync(bin, fs.constants.X_OK);
      } catch {
        throw new Error("云端节点里没有 sing-box：更新云端节点镜像后才能用节点链接");
      }
      await stop();
      stopped = false;
      generation++;
      backoff = 1000;
      lastError = null;
      cfg = { outbound: clean, port: await freePort(), user: crypto.randomBytes(6).toString("hex"), pass: crypto.randomBytes(18).toString("base64url"), secrets: outboundSecrets(clean) };
      child = spawnOnce();
      try {
        await waitReady(child, 8000);
      } catch (e) {
        const msg = scrub(e.message, [...cfg.secrets, cfg.pass]);
        await stop();
        throw new Error(msg);
      }
      return this.url();
    },
    stop,
    url() {
      return cfg && !stopped ? `socks5://${cfg.user}:${encodeURIComponent(cfg.pass)}@127.0.0.1:${cfg.port}` : null;
    },
    running: () => !stopped && !!child && child.exitCode === null,
    state: () => ({ active: !stopped, running: !stopped && !!child && child.exitCode === null, error: lastError, type: cfg && !stopped ? cfg.outbound.type : null }),
    secrets: () => (cfg ? [...cfg.secrets, cfg.pass] : []),
    /** 测试用：当前子进程。 */
    _child: () => child,
  };
}

module.exports = { createSingBox, singBoxVersion, singBoxPath, cleanOutbound, outboundSecrets, buildConfig, scrub };
