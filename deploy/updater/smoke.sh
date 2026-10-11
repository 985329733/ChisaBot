#!/bin/sh
# 管理员自检（docs/admin-smoke.md）：一次真实的模型往返，不建对话、不写消息。
# 用法：smoke.sh [机器人 id]     通过时退出码 0，否则 1。
set -u
. /opt/chisabot-updater/config.env
if [ -n "${1:-}" ]; then BODY="{\"agentId\":\"$(printf '%s' "$1" | tr -cd 'A-Za-z0-9._:-')\"}"; else BODY='{}'; fi
OUT=$(curl -s --max-time 60 -X POST -H 'content-type: application/json' -d "$BODY" "$LOCAL_URL/api/admin/smoke")
echo "$OUT"
echo "$OUT" | grep -q '"ok":true' && echo "$OUT" | grep -q '"persisted":false'
