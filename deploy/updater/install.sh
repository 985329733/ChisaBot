#!/bin/bash
# One-time host setup for the ChisaBot updater (docs/online-update.md). Run as root on the Docker host
# from a checkout's deploy/updater/ directory:
#
#   bash install.sh                 # fresh install: the first 「一键更新」 is a full build from GitHub main
#   bash install.sh <base-commit>   # an existing flattened base matches <base-commit>: code-only updates on it
#
#  - /opt/chisabot-updater/{config.env, scripts, mirror.git, spool/{requests,state}, jobs, backups}
#  - mirror.git is filled from https://github.com/$GITHUB_REPO (public repo: no token needed).
#  - spool/requests is owned by uid 1002 (the API user in the image), mode 700; spool/state is root, read-only for it.
#  - base-deps.sha256 = deps fingerprint of the commit the code-only base matches (empty = next update is full).
#  - systemd unit chisabot-updater (enabled, started).
# The compose file needs the two mounts + CHISABOT_UPDATER_DIR (see docs/online-update.md); this script does not
# edit compose.yaml. Full builds need Docker's buildx plugin (docker buildx version).
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
U=/opt/chisabot-updater
BASE_COMMIT=${1:-}
mkdir -p "$U"/{jobs,backups} "$U/spool/requests" "$U/spool/state"
for f in update.sh request.sh rollback.sh health.sh smoke.sh deps-fingerprint.sh rollback.template.sh git-askpass.sh chisabot-updater.py Dockerfile.update; do
  install -m 0755 "$HERE/$f" "$U/$f"
done
chmod 0644 "$U/Dockerfile.update" "$U/rollback.template.sh"
[ -f "$U/config.env" ] || install -m 0644 "$HERE/config.env" "$U/config.env"
chown 1002:1002 "$U/spool/requests" && chmod 0700 "$U/spool/requests"
chown root:root "$U/spool/state" && chmod 0755 "$U/spool/state"
chmod 0700 "$U/backups" "$U/jobs"
[ -d "$U/mirror.git" ] || git init --bare -q "$U/mirror.git"
# shellcheck source=/dev/null
. "$U/config.env"
if ! git --git-dir="$U/mirror.git" rev-parse -q --verify refs/heads/main >/dev/null; then
  if [ "${GITHUB_FETCH:-auto}" != off ]; then
    git --git-dir="$U/mirror.git" fetch -q --no-tags "https://github.com/${GITHUB_REPO:-ChisaAlter/ChisaBot}.git" \
      "+refs/heads/${GITHUB_BRANCH:-main}:refs/heads/main" \
      && echo "mirror.git: main = $(git --git-dir="$U/mirror.git" rev-parse --short refs/heads/main)" \
      || echo "could not fetch from GitHub; push the repository: git push root@host:$U/mirror.git main" >&2
  else
    echo "GITHUB_FETCH=off: push the repository first: git push root@host:$U/mirror.git main" >&2
  fi
fi
if [ -n "$BASE_COMMIT" ]; then
  if git --git-dir="$U/mirror.git" cat-file -e "${BASE_COMMIT}^{commit}" 2>/dev/null; then
    bash "$U/deps-fingerprint.sh" "$BASE_COMMIT" > "$U/base-deps.sha256"
    echo "base-deps.sha256 = $(cat "$U/base-deps.sha256") (from $BASE_COMMIT)"
    [ -d "${NODE_MODULES_BASE:-/nonexistent}" ] || echo "NODE_MODULES_BASE $NODE_MODULES_BASE is missing: hardlink-copy a node_modules installed from this bun.lock there (or leave it: the next update is a full build)" >&2
  else
    echo "commit $BASE_COMMIT is not in $U/mirror.git" >&2
  fi
elif [ ! -s "$U/base-deps.sha256" ]; then
  : > "$U/base-deps.sha256"
  echo "no code-only base yet: the first update from 管理后台 → 系统更新 is a full build (repository Dockerfile)"
fi
docker buildx version >/dev/null 2>&1 || echo "warning: docker buildx is missing; full builds need it (package docker-buildx-plugin)" >&2
install -m 0644 "$HERE/chisabot-updater.service" /etc/systemd/system/chisabot-updater.service
systemctl daemon-reload
systemctl enable chisabot-updater >/dev/null 2>&1
systemctl restart chisabot-updater
systemctl --no-pager status chisabot-updater | head -n 5
