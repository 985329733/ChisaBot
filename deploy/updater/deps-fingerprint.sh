#!/bin/bash
# 依赖 / 底座指纹（docs/online-update.md）：这些文件变了，一键更新（只替换代码层）就做不了。
# 用法：deps-fingerprint.sh <提交>   （读 /opt/chisabot-updater/mirror.git）
set -euo pipefail
git --git-dir=/opt/chisabot-updater/mirror.git ls-tree -r "$1" -- \
  bun.lock package.json app/package.json server/package.json worker/package.json Dockerfile docker \
  agent-computer/package.json agent-computer/bun.lock \
  | sha256sum | cut -d' ' -f1
