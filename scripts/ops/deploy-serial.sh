#!/bin/sh
# 并行开发时的串行部署（在部署宿主机上以 root 运行）：
#   sh deploy-serial.sh <期望的 main 提交前缀> [WHO]
# - flock /run/cb-deploy.lock：同一时间只一个人 / worker 部署（拿不到锁就排队，最多 40 分钟）
# - 等 updater 没有在跑的任务、没有排队的请求、线程锁 = 0
# - request.sh check → 确认本机镜像仓库的 main 包含期望提交 → request.sh update → 等完成
# - 打印最终 status；退出码 0 = 期望提交已上线
# 说明见 docs/ops/deploy.md。只走 updater 队列，从不直接调用 update.sh。
set -u
WANT=${1:?commit prefix}; WHO=${2:-hark-worker}
U=${CHISABOT_UPDATER_DIR:-/opt/chisabot-updater}
APP=${CHISABOT_APP_CONTAINER:-openbot-zh}
exec 9>/run/cb-deploy.lock
flock -w 2400 9 || { echo "DEPLOY-LOCK TIMEOUT"; exit 3; }
echo "[$(date -u +%T)] lock held by $WHO for $WANT"
st() { python3 -c "import json;j=(json.load(open('$U/spool/state/state.json')).get('job') or {});print(j.get('status') or '')" 2>/dev/null; }
busy() { s=$(st); [ "$s" = running ] || [ "$s" = queued ] || ls $U/spool/requests/*.json >/dev/null 2>&1; }
locks() { echo "select count(*) from openbot_local_threads where lock_expires_at > now()" | docker exec -i "$APP" sh -c 'export PGPASSWORD=$(cat /var/lib/postgresql/pgpassword); psql -h 127.0.0.1 -U openbot openbot -At'; }
for i in $(seq 1 240); do busy || break; sleep 10; done
for i in $(seq 1 120); do [ "$(locks)" = 0 ] && break; sleep 10; done
[ "$(locks)" = 0 ] || { echo "THREAD LOCKS STILL >0, giving up"; exit 4; }
ACTOR=$WHO sh $U/request.sh check; sleep 5
for i in $(seq 1 60); do busy || break; sleep 5; done
HEAD=$(git --git-dir=$U/mirror.git rev-parse refs/heads/main)
case "$HEAD" in $WANT*) ;; *) echo "mirror main $HEAD != wanted $WANT (someone merged after you?) — deploying mirror head only if it contains wanted"; git --git-dir=$U/mirror.git merge-base --is-ancestor $WANT $HEAD || { echo "WANTED NOT IN MAIN"; exit 5; } ;; esac
ACTOR=$WHO sh $U/request.sh update; sleep 8
for i in $(seq 1 180); do busy || break; sleep 10; done
sh $U/request.sh status
docker ps --format '{{.Image}}' --filter name=^$APP\$ | grep -q "$(echo $HEAD | cut -c1-7)" && { echo "DEPLOYED $HEAD"; exit 0; }
echo "NOT DEPLOYED"; exit 6
