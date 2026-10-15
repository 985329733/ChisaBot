#!/usr/bin/env node
"use strict";
/**
 * 模拟的 GitHub（云端 Claude Code P3 e2e 用，docs/cloud-claude-code.md §3.4）：
 *   /api/...   REST 的一小部分：GET /user、/user/repos、/repos/:o/:r、GET/POST /repos/:o/:r/pulls（Bearer 令牌）
 *   /git/...   Git smart HTTP（git http-backend，Basic x-access-token:<令牌>），可以 clone / push
 *   /_seed?repo=o/r   建一个带 README.md、package.json 的裸仓库（默认分支 main）
 *   /_state           已开的 PR、收到的 git 请求次数（测试断言用）
 * 环境变量：PORT（默认 8790）、TOKEN（唯一有效的令牌）、REPOS（裸仓库目录）。
 */
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");

const PORT = Number(process.env.PORT || 8790);
const TOKEN = process.env.TOKEN || "ghp_e2e_mock_token_0123456789abcdef";
const REPOS = path.resolve(process.env.REPOS || path.join(os.tmpdir(), "mock-gh-repos"));
const LOGIN = process.env.LOGIN || "e2e-bot";
fs.mkdirSync(REPOS, { recursive: true });
const state = { prs: [], gitAuthOk: 0, gitAuthFail: 0, apiCalls: 0 };

const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
};
const repoDir = (full) => path.join(REPOS, `${full}.git`);
const REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;

function seed(full) {
  if (!REPO.test(full)) throw new Error("bad repo");
  const dir = repoDir(full);
  if (fs.existsSync(dir)) return dir;
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", dir]);
  execFileSync("git", ["config", "http.receivepack", "true"], { cwd: dir });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mock-gh-seed-"));
  const g = (...a) => execFileSync("git", a, { cwd: tmp, env: { ...process.env, GIT_AUTHOR_NAME: "Seed", GIT_AUTHOR_EMAIL: "seed@example.com", GIT_COMMITTER_NAME: "Seed", GIT_COMMITTER_EMAIL: "seed@example.com" } });
  g("init", "-q", "-b", "main");
  fs.writeFileSync(path.join(tmp, "README.md"), `# ${full.split("/")[1]}\n\n测试仓库（模拟 GitHub）。\n`);
  fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ name: full.split("/")[1], version: "1.0.0", scripts: { test: "echo ok" } }, null, 2) + "\n");
  fs.mkdirSync(path.join(tmp, "src"));
  fs.writeFileSync(path.join(tmp, "src", "index.js"), 'console.log("hello");\n');
  g("add", "-A");
  g("commit", "-q", "-m", "初始提交");
  g("push", "-q", dir, "main");
  fs.rmSync(tmp, { recursive: true, force: true });
  return dir;
}

function repoView(full) {
  return {
    full_name: full,
    name: full.split("/")[1],
    owner: { login: full.split("/")[0] },
    default_branch: "main",
    private: true,
    description: "模拟 GitHub 上的测试仓库",
    html_url: `https://github.com/${full}`,
    clone_url: `https://github.com/${full}.git`,
    updated_at: new Date().toISOString(),
    pushed_at: new Date().toISOString(),
  };
}
function listRepos() {
  const out = [];
  for (const owner of fs.existsSync(REPOS) ? fs.readdirSync(REPOS) : []) {
    const od = path.join(REPOS, owner);
    if (!fs.statSync(od).isDirectory()) continue;
    for (const r of fs.readdirSync(od)) if (r.endsWith(".git")) out.push(repoView(`${owner}/${r.slice(0, -4)}`));
  }
  return out;
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

async function api(req, res, url) {
  state.apiCalls++;
  if ((req.headers.authorization || "") !== `Bearer ${TOKEN}`) return json(res, 401, { message: "Bad credentials" });
  const p = url.pathname.replace(/^\/api/, "");
  if (p === "/user") return json(res, 200, { login: LOGIN, name: "E2E Bot", avatar_url: "", html_url: `https://github.com/${LOGIN}` }, { "x-oauth-scopes": "repo" });
  if (p === "/user/repos" || /^\/users\/[^/]+\/repos$/.test(p)) return json(res, 200, listRepos());
  let m = /^\/repos\/([^/]+\/[^/]+)$/.exec(p);
  if (m) return fs.existsSync(repoDir(m[1])) ? json(res, 200, repoView(m[1])) : json(res, 404, { message: "Not Found" });
  m = /^\/repos\/([^/]+\/[^/]+)\/pulls$/.exec(p);
  if (m) {
    if (!fs.existsSync(repoDir(m[1]))) return json(res, 404, { message: "Not Found" });
    if (req.method === "GET") {
      const head = url.searchParams.get("head");
      return json(res, 200, state.prs.filter((x) => x.repo === m[1] && (!head || `${m[1].split("/")[0]}:${x.head}` === head)).map((x) => ({ number: x.number, html_url: x.html_url, title: x.title, head: { ref: x.head }, base: { ref: x.base }, state: "open" })));
    }
    const body = JSON.parse((await readBody(req)).toString() || "{}");
    const exists = state.prs.find((x) => x.repo === m[1] && x.head === body.head);
    if (exists) return json(res, 422, { message: "Validation Failed", errors: [{ message: `A pull request already exists for ${m[1].split("/")[0]}:${body.head}.` }] });
    // head 分支必须真的在远端
    try {
      execFileSync("git", ["rev-parse", "--verify", `refs/heads/${body.head}`], { cwd: repoDir(m[1]), stdio: "ignore" });
    } catch {
      return json(res, 422, { message: "Validation Failed", errors: [{ field: "head", code: "invalid" }] });
    }
    const number = state.prs.length + 1;
    const pr = { repo: m[1], number, title: body.title, body: body.body, head: body.head, base: body.base, draft: !!body.draft, html_url: `https://github.com/${m[1]}/pull/${number}` };
    state.prs.push(pr);
    return json(res, 201, { number, html_url: pr.html_url, state: "open" });
  }
  return json(res, 404, { message: "Not Found" });
}

async function git(req, res, url) {
  const auth = req.headers.authorization || "";
  const ok = auth.startsWith("Basic ") && Buffer.from(auth.slice(6), "base64").toString() === `x-access-token:${TOKEN}`;
  if (!ok) {
    state.gitAuthFail++;
    res.writeHead(401, { "www-authenticate": 'Basic realm="GitHub"' });
    return res.end("auth required");
  }
  state.gitAuthOk++;
  const body = await readBody(req);
  const child = spawn("git", ["http-backend"], {
    env: {
      ...process.env,
      GIT_PROJECT_ROOT: REPOS,
      GIT_HTTP_EXPORT_ALL: "1",
      PATH_INFO: url.pathname.replace(/^\/git/, ""),
      QUERY_STRING: url.search.replace(/^\?/, ""),
      REQUEST_METHOD: req.method,
      CONTENT_TYPE: req.headers["content-type"] || "",
      CONTENT_LENGTH: String(body.length),
      REMOTE_USER: "x-access-token",
      REMOTE_ADDR: "127.0.0.1",
      HTTP_GIT_PROTOCOL: req.headers["git-protocol"] || "",
    },
  });
  child.stdin.end(body);
  const chunks = [];
  child.stdout.on("data", (c) => chunks.push(c));
  child.on("close", () => {
    const buf = Buffer.concat(chunks);
    const split = buf.indexOf("\r\n\r\n");
    const head = buf.subarray(0, split).toString();
    const headers = {};
    let status = 200;
    for (const line of head.split("\r\n")) {
      const i = line.indexOf(":");
      if (i < 0) continue;
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim();
      if (k.toLowerCase() === "status") status = Number(v.split(" ")[0]);
      else headers[k] = v;
    }
    res.writeHead(status, headers);
    res.end(buf.subarray(split + 4));
  });
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const fail = (e) => json(res, 500, { message: String(e && e.message) });
    try {
      if (url.pathname === "/_seed") return json(res, 200, { dir: seed(String(url.searchParams.get("repo"))) });
      if (url.pathname === "/_state") return json(res, 200, state);
      if (url.pathname.startsWith("/api/")) return void api(req, res, url).catch(fail);
      if (url.pathname.startsWith("/git/")) return void git(req, res, url).catch(fail);
      json(res, 404, { message: "Not Found" });
    } catch (e) {
      fail(e);
    }
  })
  .listen(PORT, "0.0.0.0", () => console.log(`mock github on :${PORT} repos=${REPOS}`));
