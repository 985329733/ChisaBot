"use strict";
/**
 * 检测这台电脑上装了哪些命令行 agent、有哪些沙盒可用（docs/local-agents.md §3）。
 * 只跑 `--version` 之类不改任何东西的命令，每个最多 6 秒；结果报给服务器，设置 → 设备 → 本地 agent 显示。
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const AGENT_BINARIES = {
  claude: ["claude"],
  codex: ["codex"],
  opencode: ["opencode"],
  gemini: ["gemini"],
  aider: ["aider"],
};

/** 跑一个命令拿输出（不经过 shell，Windows 上 .cmd 例外）。 */
function capture(file, args, { timeoutMs = 6000, env, cwd } = {}) {
  return new Promise((resolve) => {
    let out = "";
    let child;
    const win = process.platform === "win32";
    try {
      child = spawn(file, args, {
        cwd,
        env: env || process.env,
        windowsHide: true,
        shell: win && /\.(cmd|bat)$/i.test(file),
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      resolve({ code: -1, out: "" });
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {}
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ code: -1, out });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, out: out.slice(0, 4000) });
    });
  });
}

/** 在 PATH 里找可执行文件（Windows 也认 .cmd / .exe / .ps1 不算）。再加几个常见安装位置。 */
function which(name) {
  const win = process.platform === "win32";
  const exts = win ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";").map((e) => e.toLowerCase()) : [""];
  const dirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const home = os.homedir();
  // Claude Code 原生安装在 ~/.local/bin；npm 全局在 %APPDATA%\npm 或 ~/.npm-global/bin。
  dirs.push(path.join(home, ".local", "bin"), path.join(home, ".npm-global", "bin"), path.join(home, ".claude", "local"));
  if (win && process.env.APPDATA) dirs.push(path.join(process.env.APPDATA, "npm"));
  if (!win) dirs.push("/usr/local/bin", "/opt/homebrew/bin", "/usr/bin");
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, win ? name + ext : name);
      try {
        const stat = fs.statSync(candidate);
        if (stat.isFile()) return candidate;
      } catch {}
    }
  }
  return null;
}

function firstVersion(text) {
  const match = /(\d+\.\d+(?:\.\d+)?(?:[-.\w]*)?)/.exec(text || "");
  return match ? match[1] : null;
}

async function detectAgents() {
  const found = [{ kind: "builtin", version: null, path: null }];
  const checks = Object.entries(AGENT_BINARIES).map(async ([kind, names]) => {
    for (const name of names) {
      const file = which(name);
      if (!file) continue;
      const result = await capture(file, ["--version"]);
      if (result.code === 0 || firstVersion(result.out)) {
        found.push({ kind, version: firstVersion(result.out), path: file });
        return;
      }
    }
  });
  await Promise.all(checks);
  return found;
}

async function detectSandboxes() {
  const platform = process.platform;
  const has = {};
  has.git = (await capture(which("git") || "git", ["--version"])).code === 0;
  has.worktree = has.git;
  has.copy = true;
  has.none = true;
  if (platform === "linux") {
    const bwrap = which("bwrap");
    // 能装上不等于能用（容器里没有 user namespace）：真的跑一次 /bin/true。
    has.bwrap = !!bwrap && (await capture(bwrap, ["--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--", "true"])).code === 0;
  }
  if (platform === "darwin") has["sandbox-exec"] = fs.existsSync("/usr/bin/sandbox-exec");
  for (const engine of ["docker", "podman"]) {
    const file = which(engine);
    has[engine] = !!file && (await capture(file, ["info", "--format", "{{.ServerVersion}}"], { timeoutMs: 8000 })).code === 0;
  }
  if (platform === "win32") {
    const wsl = which("wsl");
    has.wsl = !!wsl && (await capture(wsl, ["--status"], { timeoutMs: 8000 })).code === 0;
    has["windows-sandbox"] = fs.existsSync(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsSandbox.exe"));
  }
  return has;
}

async function detectAll() {
  const [agents, sandboxes] = await Promise.all([detectAgents(), detectSandboxes()]);
  const root = typeof process.getuid === "function" && process.getuid() === 0;
  return { agents, sandboxes, platform: process.platform, root };
}

module.exports = { detectAll, detectAgents, detectSandboxes, which, capture, firstVersion };
