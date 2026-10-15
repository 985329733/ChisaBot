#!/bin/sh
# 云端工作区节点入口：每次启动从服务器下载最新的 chisabot-node.cjs，第一次用安装码配对，然后运行。
# 环境变量：CHISABOT_SERVER（必填，例如 https://chat.example.com:8443）、CHISABOT_PAIR_CODE（第一次配对用，cbp_…）、
#           CHISABOT_NODE_NAME（默认「云端工作区」）
set -eu
DIR="${CHISABOT_NODE_DIR:-$HOME/.chisabot-node}"
SERVER="${CHISABOT_SERVER:?缺少 CHISABOT_SERVER}"
SERVER="${SERVER%/}"
mkdir -p "$DIR" "$HOME/.claude"
chmod 700 "$DIR" "$HOME/.claude"
if curl -fsSL --retry 3 --max-time 60 "$SERVER/api/devices/agent/node/chisabot-node.cjs" -o "$DIR/chisabot-node.cjs.new"; then
  mv -f "$DIR/chisabot-node.cjs.new" "$DIR/chisabot-node.cjs"
else
  rm -f "$DIR/chisabot-node.cjs.new"
  [ -f "$DIR/chisabot-node.cjs" ] || { echo "下载节点程序失败，且本地没有旧版本"; exit 1; }
  echo "下载节点程序失败，先用本地的旧版本"
fi
if [ ! -s "$DIR/config.json" ]; then
  [ -n "${CHISABOT_PAIR_CODE:-}" ] || { echo "还没有配对：设置 CHISABOT_PAIR_CODE（设置 → 设备 → 添加设备 → 服务器 里的 cbp_ 安装码）"; exit 2; }
  node "$DIR/chisabot-node.cjs" pair --server "$SERVER" --code "$CHISABOT_PAIR_CODE" --dir "$DIR" --name "${CHISABOT_NODE_NAME:-云端工作区}" --no-full-access
fi
exec node "$DIR/chisabot-node.cjs" run --dir "$DIR"
