"use strict";
/**
 * 电脑文件夹同步（P4，docs/cloud-claude-code.md §4–§5.4）：云端节点这一侧。
 *
 * 节点和同步边车 cloudnode-sync 共用网络命名空间（边车的 sshd 只听 127.0.0.1:2222，主机上没有新端口）。
 * 节点在这里做三件事：
 *   1. 隧道：服务器发 sync_tunnel_open{tunnelId} → 节点自己开一条出站 WSS 回服务器
 *      （/api/devices/agent/sync-tunnel?tunnel=…，带设备令牌），再连本机 127.0.0.1:2222，两边字节直接对接。
 *   2. 公钥：cc_rpc sync_keys_set 把每个有效绑定的公钥写进共享卷里的 authorized_keys
 *      （restrict + command="chisabot-sync-gate <工作区> <绑定>"），边车只读这个文件。
 *   3. 租约：cc_rpc sync_lease 记下谁能写 work/（服务器为准，这里是第二道闸）；ws_merge 只在租约是云端
 *      或者带着对得上的交接号时才做。
 * 另外：ws_init_local（电脑文件夹 → 云端：建一个空的 work/）、ws_manifest（暂停时清单：路径、大小、sha256）。
 */
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const ID = /^[A-Za-z0-9_-]{1,80}$/;
const KEY = /^(ssh-ed25519|ecdsa-sha2-nistp256) [A-Za-z0-9+/=]{40,800}$/;
const GATE = "/usr/local/bin/chisabot-sync-gate";
const TUNNEL_IDLE_MS = 30 * 60_000;
const MANIFEST_CAP = 50_000;

/** 默认不同步的规则（§4.6，沿用 CCC syncIgnoreConfiguration）。已被 Git 跟踪的构建产物照样同步（由 PC 端按 git ls-files 放行）。 */
const DEFAULT_IGNORES = ["dist", "build", "out", ".next", "coverage", ".cache", "cache", ".tmp", "node_modules", ".git", ".venv", "venv", "__pycache__", ".env", ".env.*", "!.env.example", "!.env.sample"];

function ignored(rel, rules = DEFAULT_IGNORES) {
  const parts = rel.split("/");
  let hit = false;
  for (const raw of rules) {
    const neg = raw.startsWith("!");
    const rule = neg ? raw.slice(1) : raw;
    const re = new RegExp(`^${rule.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")}$`);
    if (parts.some((p) => re.test(p))) hit = !neg;
  }
  return hit;
}

function wsUrl(serverUrl, pathname, query) {
  const url = new URL(serverUrl);
  url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
  url.pathname = pathname;
  url.search = new URLSearchParams(query).toString();
  url.hash = "";
  return url.toString();
}

/**
 * @param {{ root: string, serverUrl?: string, getToken?: () => string, WebSocket?: any, log?: (s: string) => void,
 *           keysDir?: string, hostPubFile?: string, sshPort?: number, sshHost?: string }} options
 */
function createSyncNode(options) {
  const log = options.log || (() => {});
  const root = options.root;
  const keysDir = options.keysDir || process.env.CHISABOT_SYNC_KEYS_DIR || "/sync-keys";
  const hostPubFile = options.hostPubFile || process.env.CHISABOT_SYNC_HOSTPUB || "/sync-pub/host_ed25519.pub";
  const sshPort = Number(options.sshPort || process.env.CHISABOT_SYNC_SSH_PORT || 2222);
  const sshHost = options.sshHost || process.env.CHISABOT_SYNC_SSH_HOST || "127.0.0.1";
  const tunnels = new Map(); // tunnelId -> { ws, sock }

  function wsDir(workspaceId) {
    if (!ID.test(String(workspaceId))) throw new Error("工作区 id 不对");
    return path.join(root, "projects", String(workspaceId));
  }
  function leaseFile(workspaceId) {
    return path.join(wsDir(workspaceId), ".chisabot", "lease.json");
  }

  // ---------- 隧道 ----------
  function openTunnel(tunnelId) {
    if (!ID.test(String(tunnelId)) || tunnels.has(tunnelId)) return;
    if (!options.serverUrl || !options.getToken) return log("同步隧道：没有服务器地址");
    const WebSocketImpl = options.WebSocket || require("ws");
    const origin = new URL(options.serverUrl).origin;
    const ws = new WebSocketImpl(wsUrl(options.serverUrl, "/api/devices/agent/sync-tunnel", { tunnel: tunnelId }), {
      headers: { "X-Device-Token": options.getToken(), Origin: origin },
      handshakeTimeout: 15_000,
      perMessageDeflate: false,
    });
    const entry = { ws, sock: null, idle: null };
    tunnels.set(tunnelId, entry);
    const end = (why) => {
      if (!tunnels.has(tunnelId)) return;
      tunnels.delete(tunnelId);
      clearTimeout(entry.idle);
      try {
        ws.close();
      } catch {}
      if (entry.sock) entry.sock.destroy();
      log(`同步隧道 ${tunnelId.slice(0, 8)} 结束（${why}）`);
    };
    const touch = () => {
      clearTimeout(entry.idle);
      entry.idle = setTimeout(() => end("空闲"), TUNNEL_IDLE_MS);
    };
    const pending = [];
    ws.on("open", () => {
      const sock = net.connect({ host: sshHost, port: sshPort });
      entry.sock = sock;
      sock.setNoDelay(true);
      sock.on("connect", () => {
        for (const chunk of pending.splice(0)) sock.write(chunk);
      });
      sock.on("data", (chunk) => {
        touch();
        if (ws.readyState === 1) {
          ws.send(chunk, { binary: true });
          // 背压：WSS 发不出去时先停读 sshd
          if (ws.bufferedAmount > 8 * 1024 * 1024) {
            sock.pause();
            const resume = setInterval(() => {
              if (ws.readyState !== 1 || ws.bufferedAmount < 1024 * 1024) {
                clearInterval(resume);
                sock.resume();
              }
            }, 20);
          }
        }
      });
      sock.on("close", () => end("sshd 关闭"));
      sock.on("error", (e) => end(`连不上同步边车：${e.code || e.message}`));
      touch();
    });
    ws.on("message", (data) => {
      touch();
      const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (entry.sock && entry.sock.readyState === "open") entry.sock.write(chunk);
      else pending.push(chunk);
    });
    ws.on("close", () => end("服务器关闭"));
    ws.on("error", (e) => end(`隧道出错：${e.message}`));
  }

  function closeAll() {
    for (const [id, t] of tunnels) {
      tunnels.delete(id);
      try {
        t.ws.close();
      } catch {}
      if (t.sock) t.sock.destroy();
    }
  }

  // ---------- 公钥 ----------
  /** keys: [{ workspaceId, bindingId, pubKey }]，整份覆盖（服务器每次给全量）。 */
  function setKeys(keys) {
    if (!Array.isArray(keys)) throw new Error("keys 不对");
    const lines = [];
    for (const k of keys) {
      const ws = String(k.workspaceId || "");
      const binding = String(k.bindingId || "");
      const key = String(k.pubKey || "").trim().split(/\s+/).slice(0, 2).join(" ");
      if (!ID.test(ws) || !ID.test(binding) || !KEY.test(key)) throw new Error("公钥或绑定不对");
      wsDir(ws);
      lines.push(`restrict,command="${GATE} ${ws} ${binding}" ${key} chisabot-${binding}`);
    }
    fs.mkdirSync(keysDir, { recursive: true });
    const file = path.join(keysDir, "authorized_keys");
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, lines.length ? `${lines.join("\n")}\n` : "", { mode: 0o644 });
    fs.renameSync(tmp, file);
    return { keys: lines.length };
  }

  function hostKey(args = {}) {
    const workPath = args.workspaceId ? path.join(wsDir(args.workspaceId), "work") : null;
    try {
      const line = fs.readFileSync(hostPubFile, "utf8").trim().split(/\s+/).slice(0, 2).join(" ");
      if (!KEY.test(line)) throw new Error("bad");
      return { hostKey: line, port: sshPort, workPath };
    } catch {
      throw new Error("同步边车还没有准备好（读不到它的主机公钥）");
    }
  }

  // ---------- 租约 ----------
  function readLease(workspaceId) {
    try {
      const j = JSON.parse(fs.readFileSync(leaseFile(workspaceId), "utf8"));
      if (j && typeof j.holder === "string") return j;
    } catch (e) {
      // 记录读不出来不算放行（§4.3）：文件存在却读不懂 → 当作冲突
      if (e && e.code !== "ENOENT") return { holder: "unknown", handoffId: null };
    }
    return { holder: "cloud", handoffId: null };
  }
  function setLease(args) {
    const holder = String(args.holder || "");
    if (!["cloud", "pc", "handoff", "syncing", "conflict"].includes(holder)) throw new Error("租约持有者不对");
    const handoffId = args.handoffId ? String(args.handoffId) : null;
    if (handoffId && !ID.test(handoffId)) throw new Error("交接号不对");
    const file = leaseFile(args.workspaceId);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ holder, handoffId, epoch: Number(args.epoch) || 0, at: new Date().toISOString() }));
    fs.renameSync(tmp, file);
    return readLease(args.workspaceId);
  }
  /** 写 work/ 之前问一次：云端租约，或者交接中且交接号对得上。 */
  function assertCloudMayWrite(workspaceId, handoffId) {
    const lease = readLease(workspaceId);
    if (lease.holder === "cloud") return;
    if (lease.holder === "handoff" && handoffId && lease.handoffId === String(handoffId)) return;
    if (lease.holder === "pc") throw new Error("电脑正在使用这个工作区，合入要先交接");
    throw new Error("工作目录现在不能写（同步中、冲突或交接未确认）");
  }

  // ---------- 工作区 ----------
  function initLocal(args) {
    const dir = path.join(wsDir(args.workspaceId), "work");
    fs.mkdirSync(dir, { recursive: true });
    // 云端这份是 Git 仓库（只在云端，.git 不走 Mutagen）：会话从工作目录快照切出 cc/ 分支、在自己的工作树里改；
    // 电脑上的文件夹本身是 Git 仓库时，它的提交经隧道推上来（ws_git_adopt）。配置照 §4.5。
    if (!fs.existsSync(path.join(dir, ".git"))) {
      const git = (a) => execFileSync("git", a, { cwd: dir, stdio: "ignore", timeout: 30_000, env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" } });
      try {
        git(["init", "-q", "-b", "main"]);
        for (const [k, v] of [["core.autocrlf", "input"], ["core.filemode", "false"], ["core.symlinks", "false"], ["user.name", "ChisaBot"], ["user.email", "chisabot@localhost"], ["receive.denyCurrentBranch", "refuse"], ["gc.auto", "0"]]) git(["config", k, v]);
      } catch (e) {
        log(`ws_init_local: git init 失败 ${e && e.message}`);
      }
    }
    setLease({ workspaceId: args.workspaceId, holder: "syncing" });
    return { path: path.relative(root, dir), git: fs.existsSync(path.join(dir, ".git")) };
  }

  /**
   * 冲突「用电脑」（§4.4）：把云端那份挪进 projects/<ws>/.chisabot/conflict-backup/<时间>/（不删），
   * Mutagen two-way-safe 看到云端删了、电脑改了，就把电脑那份带上来。只在租约是「冲突」时可以做。
   */
  function dropForConflict(args) {
    const lease = readLease(args.workspaceId);
    if (lease.holder !== "conflict") throw new Error("只有冲突时才能这样处理");
    const rel = String(args.path || "").replace(/\\/g, "/");
    if (!rel || rel.startsWith("/") || rel.split("/").some((p) => p === ".." || p === "" || p === ".git") || rel.length > 1000) throw new Error("文件路径不对");
    const work = path.join(wsDir(args.workspaceId), "work");
    const src = path.join(work, ...rel.split("/"));
    if (!src.startsWith(work + path.sep)) throw new Error("文件路径不对");
    let st;
    try {
      st = fs.lstatSync(src);
    } catch {
      return { dropped: false, missing: true };
    }
    if (st.isDirectory()) throw new Error("只能处理文件");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dest = path.join(wsDir(args.workspaceId), ".chisabot", "conflict-backup", stamp, ...rel.split("/"));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(src, dest);
    return { dropped: true, backup: path.relative(wsDir(args.workspaceId), dest) };
  }

  /** 暂停时清单（§4.4）：work/ 下每个同步的文件的大小和 sha256。 */
  function manifest(args) {
    const base = path.join(wsDir(args.workspaceId), "work");
    const rules = Array.isArray(args.ignores) && args.ignores.length ? args.ignores.map(String) : DEFAULT_IGNORES;
    const files = {};
    let count = 0;
    const walk = (dir, rel) => {
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (ignored(r, rules)) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full, r);
        else if (e.isFile()) {
          if (++count > MANIFEST_CAP) throw new Error("文件太多，清单放不下");
          const buf = fs.readFileSync(full);
          files[r] = { size: buf.length, sha256: crypto.createHash("sha256").update(buf).digest("hex") };
        }
      }
    };
    walk(base, "");
    return { files, count: Object.keys(files).length, at: new Date().toISOString() };
  }

  /**
   * 边车连得上吗（DESIGN.md §87）：连 127.0.0.1:2222，等到 sshd 的 `SSH-` 版本行。节点重启后边车留在旧的网络命名空间里时
   * 这里是 ECONNREFUSED——服务器在新建 / 开启同步之前先问一遍，连不上就什么都不建。
   */
  function probe(timeoutMs = 4000) {
    return new Promise((resolve) => {
      let done = false;
      let buf = "";
      const sock = net.connect({ host: sshHost, port: sshPort });
      const finish = (r) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        sock.destroy();
        resolve(r);
      };
      const timer = setTimeout(() => finish({ ok: false, error: "边车没有应答（超时）" }), timeoutMs);
      sock.on("data", (chunk) => {
        buf += chunk.toString("latin1");
        if (buf.startsWith("SSH-")) finish({ ok: true, error: null });
        else if (buf.length >= 4) finish({ ok: false, error: "边车应答不对" });
      });
      sock.on("error", (e) => finish({ ok: false, error: `连不上同步边车：${e.code || e.message}` }));
      sock.on("close", () => finish({ ok: false, error: "边车断开了连接" }));
    });
  }

  const HANDLED = new Set(["sync_tunnel_open", "sync_tunnel_close"]);
  const RPC = new Set(["sync_probe", "sync_keys_set", "sync_host_key", "sync_lease", "sync_lease_get", "ws_init_local", "ws_manifest", "ws_sync_drop"]);

  return {
    handles: (type) => HANDLED.has(type),
    handle(message) {
      if (!message || !HANDLED.has(message.type)) return false;
      if (message.type === "sync_tunnel_open") openTunnel(String(message.tunnelId || ""));
      else {
        const t = tunnels.get(String(message.tunnelId || ""));
        if (t) {
          try {
            t.ws.close();
          } catch {}
        }
      }
      return true;
    },
    rpcs: RPC,
    rpc(op, args) {
      switch (op) {
        case "sync_probe":
          return probe();
        case "sync_keys_set":
          return setKeys(args.keys);
        case "sync_host_key":
          return hostKey(args);
        case "sync_lease":
          return setLease(args);
        case "sync_lease_get":
          return readLease(args.workspaceId);
        case "ws_init_local":
          return initLocal(args);
        case "ws_manifest":
          return manifest(args);
        case "ws_sync_drop":
          return dropForConflict(args);
        default:
          throw new Error(`不认识的操作 ${op}`);
      }
    },
    assertCloudMayWrite,
    tunnelCount: () => tunnels.size,
    closeAll,
  };
}

module.exports = { createSyncNode, ignored, DEFAULT_IGNORES, wsUrl };
