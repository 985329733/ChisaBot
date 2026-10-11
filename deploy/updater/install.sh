#!/bin/bash
# One-time host setup for the ChisaBot updater (docs/online-update.md). Run as root on the Docker host
# from a checkout's deploy/updater/ directory:  bash install.sh <commit-the-running-base-matches>
#
#  - /opt/chisabot-updater/{config.env, scripts, mirror.git, node_modules-base, spool/{requests,state}, jobs, backups}
#  - spool/requests is owned by uid 1002 (the API user in the image), mode 700; spool/state is root, read-only for it.
#  - base-deps.sha256 = deps fingerprint of the commit the current flattened base was built from.
#  - systemd unit chisabot-updater (enabled, started).
# The compose file needs the two mounts + CHISABOT_UPDATER_DIR (see docs/online-update.md); this script does not
# edit compose.yaml.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
U=/opt/chisabot-updater
BASE_COMMIT=${1:?usage: install.sh <base-commit>}
mkdir -p "$U"/{jobs,backups} "$U/spool/requests" "$U/spool/state"
for f in update.sh rollback.sh health.sh smoke.sh deps-fingerprint.sh rollback.template.sh git-askpass.sh chisabot-updater.py Dockerfile.update; do
  install -m 0755 "$HERE/$f" "$U/$f"
done
chmod 0644 "$U/Dockerfile.update" "$U/rollback.template.sh"
[ -f "$U/config.env" ] || install -m 0644 "$HERE/config.env" "$U/config.env"
chown 1002:1002 "$U/spool/requests" && chmod 0700 "$U/spool/requests"
chown root:root "$U/spool/state" && chmod 0755 "$U/spool/state"
chmod 0700 "$U/backups" "$U/jobs"
[ -d "$U/mirror.git" ] || git init --bare -q "$U/mirror.git"
. "$U/config.env"
if [ ! -d "$NODE_MODULES_BASE" ]; then
  echo "NODE_MODULES_BASE $NODE_MODULES_BASE is missing: hardlink-copy a node_modules installed from this bun.lock there" >&2
fi
if git --git-dir="$U/mirror.git" cat-file -e "${BASE_COMMIT}^{commit}" 2>/dev/null; then
  bash "$U/deps-fingerprint.sh" "$BASE_COMMIT" > "$U/base-deps.sha256"
  echo "base-deps.sha256 = $(cat "$U/base-deps.sha256") (from $BASE_COMMIT)"
else
  echo "push the repository to $U/mirror.git first (git push root@host:$U/mirror.git main), then re-run" >&2
fi
install -m 0644 "$HERE/chisabot-updater.service" /etc/systemd/system/chisabot-updater.service
systemctl daemon-reload
systemctl enable chisabot-updater >/dev/null 2>&1
systemctl restart chisabot-updater
systemctl --no-pager status chisabot-updater | head -n 5
