#!/bin/sh
# 同步边车看门狗（DESIGN.md §87）：边车用 network_mode: service:cloudnode 共用节点的网络命名空间。
# `docker restart chisabot-cloudnode`（每次更新 pc/src/cloud-cc 都要做）会给节点一个新的命名空间，边车却还留在旧的里面，
# 节点连 127.0.0.1:2222 就是 ECONNREFUSED——电脑文件夹新建 / 开启同步全部失败（2026-10-16 「导入失败后残留」的根因）。
# 这里比较两个容器的 netns，不一样就重启边车（它会重新加入节点当前的命名空间）。systemd 定时器每 30 秒跑一次。
#   NODE=chisabot-cloudnode SIDE=chisabot-cloudnode-sync sh sync-watch.sh
set -u
NODE=${NODE:-chisabot-cloudnode}
SIDE=${SIDE:-chisabot-cloudnode-sync}
ns() {
  pid=$(docker inspect -f '{{if .State.Running}}{{.State.Pid}}{{end}}' "$1" 2>/dev/null) || return 1
  [ -n "$pid" ] && [ "$pid" != 0 ] || return 1
  readlink "/proc/$pid/ns/net"
}
N=$(ns "$NODE") || exit 0          # 节点没在跑：不管（边车跟着它起）
S=$(ns "$SIDE") || S=none
[ "$N" = "$S" ] && exit 0
logger -t chisabot-syncwatch "sidecar netns $S != node netns $N, restarting $SIDE" 2>/dev/null || true
echo "$(date -u +%FT%TZ) sidecar netns $S != node netns $N → docker restart $SIDE"
docker restart "$SIDE" >/dev/null
