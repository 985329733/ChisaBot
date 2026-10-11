#!/usr/bin/env python2
# -*- coding: utf-8 -*-
"""
ChisaBot 宿主机更新程序（docs/online-update.md）。root 的 systemd 服务 chisabot-updater。

ChisaBot 容器没有 docker socket。它只能往 spool/requests/ 里放请求文件：
    {"id": "...", "action": "check" | "update" | "rollback", "actor": "...", "expectCommit": "<sha>"?}
这个程序每 2 秒取一次，只认这三种动作，从不执行请求里的任何字符串；更新 / 回滚交给同目录的
update.sh / rollback.sh（带锁，同一时间只有一个）。它把状态写进 spool/state/state.json（容器里只读挂载），
管理后台 → 系统更新 读这个文件显示版本、新提交、进度、日志和历史。

更新来源：本机裸仓库 mirror.git。有 /opt/chisabot-updater/github-token（root 600，只读令牌）时从 GitHub
拉 main；没有时读本机镜像本身（发布时由发布者 git push 到这里）。

为了兼容 CentOS 7 自带的 python2.7 / git 1.8 写成这样；不依赖第三方包。
"""
import json
import os
import re
import subprocess
import sys
import threading
import time
from datetime import datetime, timedelta

U = "/opt/chisabot-updater"
SPOOL = os.path.join(U, "spool")
REQ = os.path.join(SPOOL, "requests")
STATE_DIR = os.path.join(SPOOL, "state")
STATE_FILE = os.path.join(STATE_DIR, "state.json")
INTERNAL = os.path.join(U, "internal.json")
JOBS = os.path.join(U, "jobs")
AUDIT = os.path.join(U, "audit.log")
MIRROR = os.path.join(U, "mirror.git")
TOKEN_FILE = os.path.join(U, "github-token")
VERSION = "1"

ID_RE = re.compile(r"^[A-Za-z0-9_-]{6,64}$")
NAME_RE = re.compile(r"^[A-Za-z0-9_-]{6,64}\.json$")
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
CTRL_RE = re.compile(u"[\x00-\x08\x0b-\x1f\x7f]|\x1b\\[[0-9;]*[A-Za-z]")
ACTIONS = ("check", "update", "rollback")

CHECK_EVERY = 30 * 60
REFRESH_EVERY = 30


def now_iso():
    return datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")


def load_config():
    cfg = {}
    with open(os.path.join(U, "config.env")) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            cfg[k.strip()] = v.strip().strip('"')
    return cfg


CFG = load_config()


def run(args, timeout=60, env=None):
    """返回 (code, stdout)。stderr 并进 stdout。"""
    p = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env)
    deadline = time.time() + timeout
    while p.poll() is None:
        if time.time() > deadline:
            try:
                p.kill()
            except OSError:
                pass
            return 124, "超时"
        time.sleep(0.1)
    return p.returncode, p.stdout.read().decode("utf-8", "replace")


def git(*args):
    return run(["git", "--git-dir=" + MIRROR] + list(args), timeout=120)


def clean(text, limit=400):
    if not isinstance(text, basestring):
        return ""
    if isinstance(text, str):
        text = text.decode("utf-8", "replace")
    return CTRL_RE.sub(u"", text).strip()[:limit]


def write_json(path, data, mode=0o644):
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, ensure_ascii=True, indent=1)
    os.chmod(tmp, mode)
    os.rename(tmp, path)


def audit(entry):
    entry = dict(entry)
    entry["at"] = now_iso()
    with open(AUDIT, "a") as f:
        f.write(json.dumps(entry, ensure_ascii=False).encode("utf-8") + "\n")


class Updater(object):
    def __init__(self):
        self.lock = threading.Lock()
        self.internal = {"job": None, "history": [], "source": None}
        try:
            with open(INTERNAL) as f:
                self.internal.update(json.load(f))
        except (IOError, ValueError):
            pass
        self.child = None
        self.snapshot = {}
        self.last_refresh = 0
        self.last_check = 0
        self.checking = False

    # ---------- 持久化 ----------
    def save_internal(self):
        write_json(INTERNAL, self.internal, 0o600)

    def add_history(self, job, status, error=None):
        entry = {
            "id": job["id"],
            "action": job["action"],
            "status": status,
            "at": now_iso(),
            "actor": job.get("actor"),
        }
        for k in ("fromImage", "toImage", "targetCommit"):
            if job.get(k):
                entry["commit" if k == "targetCommit" else k] = job[k]
        if error:
            entry["error"] = error
        self.internal["history"] = ([entry] + self.internal.get("history", []))[:30]

    # ---------- 来源 ----------
    def fetch(self):
        """有令牌就从 GitHub 拉 main；没有就只读本机镜像。返回 source 字典。"""
        repo = CFG.get("GITHUB_REPO", "ChisaAlter/ChisaBot")
        branch = CFG.get("GITHUB_BRANCH", "main")
        source = {"repo": repo, "branch": branch, "fetchedAt": now_iso()}
        if os.path.isfile(TOKEN_FILE) and os.path.getsize(TOKEN_FILE) > 0:
            source["kind"] = "github"
            env = dict(os.environ)
            env["GIT_ASKPASS"] = os.path.join(U, "git-askpass.sh")
            env["GIT_TERMINAL_PROMPT"] = "0"
            code, out = run(
                ["git", "--git-dir=" + MIRROR, "fetch", "--quiet",
                 "https://x-access-token@github.com/%s.git" % repo,
                 "+refs/heads/%s:refs/heads/main" % branch],
                timeout=120, env=env)
            if code != 0:
                source["error"] = u"从 GitHub 拉取失败：" + clean(out.replace("\n", " "), 200)
        else:
            source["kind"] = "mirror"
        return source

    # ---------- 状态 ----------
    def current(self):
        c = CFG["CONTAINER"]
        code, image = run(["docker", "inspect", "-f", "{{.Config.Image}}", c], timeout=20)
        if code != 0:
            return None
        image = image.strip()
        _, commit = run(["docker", "image", "inspect", "-f", '{{index .Config.Labels "chisabot.commit"}}', image], timeout=20)
        _, started = run(["docker", "inspect", "-f", "{{.State.StartedAt}}", c], timeout=20)
        cur = {"image": image}
        commit = commit.strip()
        if SHA_RE.match(commit):
            cur["commit"] = commit
        started = started.strip()[:19]
        if re.match(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$", started):
            cur["deployedAt"] = started + "Z"
        return cur

    def previous(self, cur):
        if not cur:
            return None
        tag = cur["image"].split(":")[-1]
        before = os.path.join(CFG["COMPOSE_DIR"], "%s.before-%s" % (CFG["COMPOSE_FILE"], tag))
        try:
            with open(before) as f:
                for line in f:
                    m = re.match(r"^    image: (%s:[A-Za-z0-9._-]+)\s*$" % re.escape(CFG["IMAGE_REPO"]), line)
                    if m:
                        prev = {"image": m.group(1)}
                        code, commit = run(["docker", "image", "inspect", "-f", '{{index .Config.Labels "chisabot.commit"}}', prev["image"]], timeout=20)
                        if code != 0:
                            return None  # 镜像已删，不能回滚
                        if SHA_RE.match(commit.strip()):
                            prev["commit"] = commit.strip()
                        return prev
        except IOError:
            return None
        return None

    def commits(self, cur):
        code, main = git("rev-parse", "refs/heads/main")
        main = main.strip()
        if code != 0 or not SHA_RE.match(main):
            return None, None, [], False, None

        def parse(out):
            items = []
            for line in out.splitlines():
                parts = line.split("\x1f")
                if len(parts) != 4 or not SHA_RE.match(parts[0]):
                    continue
                date = parts[3].strip()
                try:
                    d = datetime.strptime(date[:19], "%Y-%m-%d %H:%M:%S")
                    sign = 1 if date[20] == "+" else -1
                    off = sign * (int(date[21:23]) * 60 + int(date[23:25]))
                    iso = (d - timedelta(minutes=off)).strftime("%Y-%m-%dT%H:%M:%SZ")
                except (ValueError, IndexError):
                    iso = None
                item = {"sha": parts[0], "subject": clean(parts[1], 200), "author": clean(parts[2], 80)}
                if iso:
                    item["date"] = iso
                items.append(item)
            return items

        fmt = "--format=%H%x1f%s%x1f%an%x1f%ai"
        _, head = git("log", "-1", fmt, main)
        latest = (parse(head) or [None])[0]
        behind = None
        items = []
        if cur and cur.get("commit"):
            code, _ = git("cat-file", "-e", cur["commit"] + "^{commit}")
            if code == 0:
                _, out = git("log", fmt, "-50", "%s..%s" % (cur["commit"], main))
                items = parse(out)
                _, n = git("rev-list", "--count", "%s..%s" % (cur["commit"], main))
                try:
                    behind = int(n.strip())
                except ValueError:
                    behind = len(items)
        code, fp = run(["bash", os.path.join(U, "deps-fingerprint.sh"), main], timeout=30)
        try:
            base = open(os.path.join(U, "base-deps.sha256")).read().strip()
        except IOError:
            base = ""
        deps_changed = bool(behind) and code == 0 and fp.strip() != base
        return main, latest, items, deps_changed, behind

    def refresh(self):
        cur = self.current()
        main, latest, items, deps, behind = self.commits(cur)
        with self.lock:
            self.snapshot = {
                "current": cur,
                "previous": self.previous(cur),
                "main": main,
                "latest": latest,
                "commits": items,
                "behind": behind,
                "depsChanged": deps,
            }
            if cur and cur.get("commit") and main == cur["commit"]:
                self.snapshot["behind"] = 0
            self.last_refresh = time.time()
        self.write_state()

    def write_state(self):
        with self.lock:
            snap = dict(self.snapshot)
            job = self.internal.get("job")
            state = {
                "updaterVersion": VERSION,
                "updatedAt": now_iso(),
                "current": snap.get("current"),
                "previous": snap.get("previous"),
                "source": self.internal.get("source"),
                "latest": snap.get("latest"),
                "behind": snap.get("behind"),
                "commits": snap.get("commits") or [],
                "depsChanged": bool(snap.get("depsChanged")),
                "job": job,
                "history": self.internal.get("history", []),
            }
        write_json(STATE_FILE, state)

    # ---------- 请求 ----------
    def reject(self, req, reason):
        entry = {"id": req.get("id", "unknown-" + str(int(time.time()))), "action": req.get("action", "check"),
                 "actor": clean(req.get("actor", ""), 80)}
        self.add_history(entry, "rejected", reason)
        audit({"event": "request_rejected", "id": entry["id"], "action": entry["action"], "actor": entry["actor"], "reason": reason})
        self.save_internal()

    def take_requests(self):
        try:
            names = sorted(os.listdir(REQ))
        except OSError:
            return
        for name in names:
            path = os.path.join(REQ, name)
            if not NAME_RE.match(name):
                continue
            try:
                if os.path.getsize(path) > 4096:
                    raise ValueError("too big")
                with open(path) as f:
                    req = json.load(f)
            except (IOError, OSError, ValueError):
                req = None
            try:
                os.unlink(path)
            except OSError:
                pass
            if not isinstance(req, dict) or req.get("action") not in ACTIONS or not ID_RE.match(str(req.get("id", ""))):
                continue
            self.handle(req)

    def busy(self):
        job = self.internal.get("job")
        return bool(job and job.get("status") in ("queued", "running"))

    def handle(self, req):
        action = req["action"]
        actor = clean(req.get("actor", ""), 80)
        if action == "check":
            self.start_check()
            return
        if self.busy():
            return self.reject(req, u"已经有一个更新或回滚在进行")
        self.refresh()
        snap = self.snapshot
        if action == "update":
            main = snap.get("main")
            if not main:
                return self.reject(req, u"本机镜像里没有 main")
            expect = req.get("expectCommit")
            if expect and expect != main:
                return self.reject(req, u"main 已经变了（现在是 %s），请刷新页面后重试" % main[:7])
            if snap.get("depsChanged"):
                return self.reject(req, u"依赖或底座有变化，需要完整构建")
            if snap.get("current", {}) and snap["current"].get("commit") == main:
                return self.reject(req, u"已经是最新版本")
            args = ["/bin/bash", os.path.join(U, "update.sh"), "--job", req["id"], "--target", main]
            job = {"id": req["id"], "action": "update", "status": "running", "step": "prepare", "startedAt": now_iso(),
                   "actor": actor, "targetCommit": main, "log": []}
        else:
            if not snap.get("previous"):
                return self.reject(req, u"没有可以回滚到的上一版")
            args = ["/bin/bash", os.path.join(U, "rollback.sh"), "--job", req["id"]]
            job = {"id": req["id"], "action": "rollback", "status": "running", "step": "prepare", "startedAt": now_iso(),
                   "actor": actor, "log": []}
        audit({"event": "job_started", "id": job["id"], "action": action, "actor": actor, "target": job.get("targetCommit")})
        log = open(os.path.join(JOBS, job["id"] + ".log"), "w")
        # 自己一个会话：服务重启（KillMode=process）时更新脚本不会被一起杀掉。
        self.child = subprocess.Popen(args, stdout=log, stderr=subprocess.STDOUT, preexec_fn=os.setsid, close_fds=True)
        with self.lock:
            self.internal["job"] = job
        self.save_internal()
        self.write_state()

    def start_check(self):
        if self.checking:
            return
        self.checking = True

        def work():
            try:
                source = self.fetch()
                with self.lock:
                    self.internal["source"] = source
                self.save_internal()
                self.last_check = time.time()
                self.refresh()
            finally:
                self.checking = False

        t = threading.Thread(target=work)
        t.daemon = True
        t.start()

    # ---------- 任务进度 ----------
    def lock_held(self):
        code, _ = run(["flock", "-n", os.path.join(U, "update.lock"), "true"], timeout=10)
        return code != 0

    def poll_job(self):
        job = self.internal.get("job")
        if not job or job.get("status") != "running":
            return
        path = os.path.join(JOBS, job["id"] + ".log")
        try:
            with open(path) as f:
                lines = f.read().decode("utf-8", "replace").splitlines()
        except IOError:
            lines = []
        result = None
        visible = []
        for line in lines:
            line = clean(line, 400)
            if not line:
                continue
            if line.startswith("::step:: "):
                job["step"] = line[9:].strip()[:20]
            elif line.startswith("::result:: "):
                result = line[11:].strip()
            elif line.startswith("::from:: "):
                job["fromImage"] = line[9:].strip()
            elif line.startswith("::to:: "):
                job["toImage"] = line[7:].strip()
            elif line.startswith("::error:: "):
                job["error"] = line[10:].strip()[:400]
                visible.append(u"✕ " + line[10:])
            elif line.startswith("::"):
                continue
            else:
                visible.append(line)
        job["log"] = visible[-60:]
        finished = False
        if self.child is not None:
            if self.child.poll() is not None:
                finished = True
                code = self.child.returncode
                self.child = None
                if result is None:
                    result = "succeeded" if code == 0 else ("rolled_back" if code == 3 else "failed")
        elif result is not None or not self.lock_held():
            # 服务重启后接手的任务：脚本跑完（写了 result 或锁已释放）就结束。
            finished = True
            if result is None:
                result = "failed"
                job["error"] = job.get("error") or u"更新程序重启期间任务中断，请查看日志"
        if finished:
            job["status"] = result if result in ("succeeded", "failed", "rolled_back") else "failed"
            job["finishedAt"] = now_iso()
            if job["status"] == "succeeded":
                job.pop("error", None)
            self.add_history(job, job["status"], job.get("error"))
            audit({"event": "job_finished", "id": job["id"], "action": job["action"], "status": job["status"],
                   "from": job.get("fromImage"), "to": job.get("toImage"), "error": job.get("error")})
            self.save_internal()
            self.refresh()
        else:
            self.write_state()

    def loop(self):
        for d in (REQ, STATE_DIR, JOBS):
            if not os.path.isdir(d):
                os.makedirs(d)
        self.start_check()
        while True:
            try:
                self.take_requests()
                self.poll_job()
                if time.time() - self.last_check > CHECK_EVERY:
                    self.start_check()
                elif time.time() - self.last_refresh > REFRESH_EVERY:
                    self.refresh()
            except Exception as error:  # 守护进程不因一次异常退出
                sys.stderr.write("chisabot-updater: %r\n" % (error,))
                sys.stderr.flush()
                time.sleep(5)
            time.sleep(2)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--once":
        u = Updater()
        u.internal["source"] = u.fetch()
        u.save_internal()
        u.refresh()
        print(open(STATE_FILE).read())
    else:
        Updater().loop()
