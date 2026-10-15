"use strict";
/**
 * 自编译的 MIT 版 Mutagen v0.18.1（-tags mutagencli，不带 mutagensspl）的命令行封装（P4b）。
 * 守护进程由 PC 客户端自己起（`mutagen daemon run`，子进程），数据目录在 userData/sync/mutagen，
 * 环境变量里带上 ssh 包装器目录（MUTAGEN_SSH_PATH）、本机中转口令（CHISABOT_SYNC_SECRET）和
 * ELECTRON_RUN_AS_NODE=1（ProxyCommand 用 ChisaBotPC.exe 当 Node 跑 tunnel.js）。
 */
const { spawn, execFile } = require("node:child_process");

/** 默认不同步的规则（§4.6，和节点 pc/src/cloud-cc/sync.js 的 DEFAULT_IGNORES 一致）。 */
const IGNORES = ["node_modules", ".env", ".env.*", "!.env.example", "!.env.sample", "dist", "build", "out", ".next", "coverage", ".cache", "cache", ".tmp", ".venv", "venv", "__pycache__"];

function sessionName(workspaceId) {
  return `cb-${String(workspaceId).replace(/_/g, "-")}`;
}

/**
 * @param {{ bin: string, env: () => Record<string, string>, log?: (s: string) => void, spawnImpl?: any }} options
 */
function createMutagen(options) {
  const log = options.log || (() => {});
  let daemon = null;

  function run(args, { timeout = 120_000 } = {}) {
    return new Promise((resolve) => {
      execFile(options.bin, args, { env: options.env(), timeout, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
        resolve({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout: String(stdout || ""), stderr: String(stderr || "") });
      });
    });
  }

  async function startDaemon() {
    // 上次没关干净的守护进程（环境变量里是旧口令）先停掉
    await run(["daemon", "stop"], { timeout: 20_000 });
    daemon = spawn(options.bin, ["daemon", "run"], { env: options.env(), stdio: "ignore", windowsHide: true, detached: false });
    daemon.on("exit", (code) => {
      log(`Mutagen 守护进程退出（${code}）`);
      daemon = null;
    });
    for (let i = 0; i < 40; i++) {
      const r = await run(["sync", "list"], { timeout: 10_000 });
      if (r.code === 0) return true;
      await new Promise((res) => setTimeout(res, 250));
    }
    throw new Error("Mutagen 守护进程没有起来");
  }

  async function stopDaemon() {
    await run(["daemon", "stop"], { timeout: 20_000 });
    try {
      daemon && daemon.kill();
    } catch {}
    daemon = null;
  }

  /** 所有会话（JSON）。读不到时返回 null。 */
  async function list() {
    const r = await run(["sync", "list", "--template", "{{json .}}"], { timeout: 30_000 });
    if (r.code !== 0) return null;
    try {
      const v = JSON.parse(r.stdout.trim() || "[]");
      return Array.isArray(v) ? v : [];
    } catch {
      return null;
    }
  }

  async function get(workspaceId) {
    const all = await list();
    return all ? all.find((s) => s.name === sessionName(workspaceId)) || null : null;
  }

  async function create({ workspaceId, local, remote, labels = {} }) {
    const args = [
      "sync",
      "create",
      `--name=${sessionName(workspaceId)}`,
      "--sync-mode=two-way-safe",
      "--stage-mode-beta=neighboring",
      "--ignore-vcs",
      ...IGNORES.map((i) => `--ignore=${i}`),
      ...Object.entries(labels).map(([k, v]) => `--label=${k}=${v}`),
      local,
      remote,
    ];
    const r = await run(args, { timeout: 120_000 });
    if (r.code !== 0) throw new Error(`建立同步失败：${(r.stderr || r.stdout).trim().split("\n").slice(-2).join(" ").slice(0, 300)}`);
    return true;
  }

  async function simple(verb, workspaceId, timeout = 60_000) {
    const r = await run(["sync", verb, sessionName(workspaceId)], { timeout });
    if (r.code !== 0) throw new Error(`${verb} 失败：${(r.stderr || r.stdout).trim().split("\n").slice(-2).join(" ").slice(0, 300)}`);
    return true;
  }

  return {
    run,
    startDaemon,
    stopDaemon,
    list,
    get,
    create,
    pause: (ws) => simple("pause", ws),
    resume: (ws) => simple("resume", ws),
    flush: (ws, timeout = 10 * 60_000) => simple("flush", ws, timeout),
    terminate: (ws) => simple("terminate", ws),
    reset: (ws) => simple("reset", ws),
    running: () => !!daemon,
  };
}

/** Mutagen 的会话状态 → 五种状态（§4.2）+ 附注。 */
function classify(session) {
  if (!session) return { state: "syncing", detail: "同步会话还没建立" };
  const conflicts = Array.isArray(session.conflicts) ? session.conflicts : [];
  const status = String(session.status || "");
  if (session.paused) return { state: "paused", detail: "已暂停" };
  if (conflicts.length) return { state: "conflict", detail: `${conflicts.length} 个文件两边都改过` };
  if (/^halted-on-root-emptied/.test(status)) return { state: "conflict", detail: "有一边整个被清空了，先停下来等你确认" };
  if (/^halted/.test(status)) return { state: "conflict", detail: "同步停下来了，需要你处理" };
  if (status === "watching") return { state: "pc_active", detail: "已同步，正在监视改动" };
  if (status === "disconnected" || /^connecting/.test(status)) return { state: "syncing", detail: session.lastError ? `连不上云端：${String(session.lastError).slice(0, 120)}` : "正在连接云端" };
  return { state: "syncing", detail: STATUS_ZH[status] || "同步中" };
}

const STATUS_ZH = {
  scanning: "正在扫描文件",
  "waiting-for-rescan": "等待重新扫描",
  reconciling: "正在对比两边",
  "staging-alpha": "正在从云端下载",
  "staging-beta": "正在上传到云端",
  transitioning: "正在写入文件",
  saving: "正在保存",
};

/** 冲突列表：每个冲突的根路径 + 两边的改动种类。 */
function conflictList(session) {
  const out = [];
  for (const c of (session && session.conflicts) || []) {
    const root = String(c.root || "");
    out.push({ path: root, kind: kindOf(c) });
  }
  return out;
}
function kindOf(c) {
  const a = (c.alphaChanges || [])[0] || {};
  const b = (c.betaChanges || [])[0] || {};
  const isDel = (x) => x && x.old && !x.new;
  if (isDel(a) || isDel(b)) return "deleted";
  return "file";
}

module.exports = { createMutagen, classify, conflictList, sessionName, IGNORES };
