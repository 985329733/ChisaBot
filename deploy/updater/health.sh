#!/bin/bash
# 健康检查（docs/online-update.md）：容器 healthy、没有重启、本机 /health 200、公网登录页 200，
# 给了构建号时 /api/version 必须是这一版。用法：health.sh <镜像> [构建号]
set -uo pipefail
. /opt/chisabot-updater/config.env
IMAGE="$1" TAG="${2:-}"
for i in $(seq 1 36); do
  H=$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null)
  [ "$H" = healthy ] && break
  sleep 5
done
IMG=$(docker inspect -f '{{.Config.Image}}' "$CONTAINER" 2>/dev/null)
echo "容器 $H，镜像 $IMG"
[ "$H" = healthy ] && [ "$IMG" = "$IMAGE" ] || { echo "容器不健康或镜像不对"; exit 1; }
R0=$(docker inspect -f '{{.RestartCount}}' "$CONTAINER")
sleep 20
R1=$(docker inspect -f '{{.RestartCount}}' "$CONTAINER")
H=$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER")
[ "$R0" = "$R1" ] && [ "$H" = healthy ] || { echo "20 秒内重启过（$R0 → $R1）或不再健康（$H）"; exit 1; }
C=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$LOCAL_URL/health")
echo "本机 /health $C"
[ "$C" = 200 ] || exit 1
P=$(curl -ks -o /dev/null -w '%{http_code}' --max-time 15 "$PUBLIC_HEALTH_URL")
echo "公网 $PUBLIC_HEALTH_URL $P"
[ "$P" = 200 ] || exit 1
if [ -n "$TAG" ]; then
  V=$(curl -s --max-time 10 "$LOCAL_URL/api/version")
  echo "/api/version $V"
  echo "$V" | grep -q "\"buildId\":\"$TAG\"" || { echo "/api/version 不是新构建 $TAG"; exit 1; }
fi
echo "健康检查通过"
