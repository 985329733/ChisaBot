#!/bin/sh
# chisabot-sync-gate <工作区> <绑定代号>（authorized_keys 里的 command=，docs/cloud-claude-code.md §5.3）
# 只放行两类命令（SSH_ORIGINAL_COMMAND）：
#   1. Mutagen 0.18.1 的同步 agent：.mutagen/agents/0.18.1/mutagen-agent synchronizer --log-level=<级别>
#      （不放行 forwarder：那是端口转发；也不放行 uname 探测 / 安装：agent 已经预装，版本必须一致）
#   2. 这个工作区工作目录的 git upload-pack / receive-pack
# 其它一律拒绝（退出码 126），并在 stderr 说明。
set -eu
WS="${1:-}"; BINDING="${2:-}"
case "$WS" in ''|*[!A-Za-z0-9_-]*) echo "chisabot-sync-gate: 工作区不对" >&2; exit 126;; esac
case "$BINDING" in ''|*[!A-Za-z0-9_-]*) echo "chisabot-sync-gate: 绑定不对" >&2; exit 126;; esac
CMD="${SSH_ORIGINAL_COMMAND:-}"
WORK="/workspace/projects/$WS/work"
log() { echo "$(date -u +%FT%TZ) gate ws=$WS binding=$BINDING $*" >&2; }
case "$CMD" in
  ".mutagen/agents/0.18.1/mutagen-agent synchronizer --log-level="*)
    LEVEL="${CMD#*--log-level=}"
    case "$LEVEL" in disabled|error|warn|info|debug|trace) ;; *) log "deny level"; exit 126;; esac
    [ -d "$WORK" ] || { log "deny: no work dir"; exit 126; }
    cd "$WORK"
    exec /opt/mutagen/mutagen-agent synchronizer "--log-level=$LEVEL"
    ;;
  "git-upload-pack '$WORK'"|"git-upload-pack '$WORK/.git'"|"git upload-pack '$WORK'"|"git upload-pack '$WORK/.git'")
    exec git-upload-pack "$WORK"
    ;;
  "git-receive-pack '$WORK'"|"git-receive-pack '$WORK/.git'"|"git receive-pack '$WORK'"|"git receive-pack '$WORK/.git'")
    exec git-receive-pack "$WORK"
    ;;
esac
log "deny: $(printf '%.120s' "$CMD")"
echo "chisabot-sync-gate: 这条命令不允许" >&2
exit 126
