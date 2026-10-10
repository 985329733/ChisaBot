#!/bin/sh
set -eu
cd "$(dirname "$0")"
if ! test -f .env; then
  echo 'Missing deploy/.env. Copy .env.example and configure encryption keys first.' >&2
  exit 1
fi
if ! test -f ../app/dist/index.html; then
  echo 'Build the frontend first: TENANT_PACKAGE_DIR=../examples/zh-CN bun run --cwd app build (from the repository root).' >&2
  exit 1
fi

docker compose -p openbot-zh -f compose.yaml config --quiet
# Read only the non-secret network name. Do not source .env as shell code.
magpie_network=${MAGPIE_NETWORK:-$(sed -n 's/^MAGPIE_NETWORK=//p' .env | tail -n 1 | tr -d '\r"\047')}
magpie_network=${magpie_network:-openbot_magpie}
case "$magpie_network" in *[!a-zA-Z0-9_.-]*|"") echo 'Invalid MAGPIE_NETWORK name.' >&2; exit 1 ;; esac
docker network inspect "$magpie_network" >/dev/null 2>&1 || docker network create "$magpie_network" >/dev/null
docker compose -p openbot-zh -f compose.yaml up -d --build --wait --wait-timeout 180 openbot

# Opt in only on a Linux host with systemd. Keep names compatible with existing deployments.
if [ "${CHISABOT_ENABLE_TIMERS:-0}" = 1 ]; then
  if [ "$(id -u)" != 0 ] || ! command -v systemctl >/dev/null 2>&1; then
    echo 'CHISABOT_ENABLE_TIMERS=1 requires root and systemd.' >&2
    exit 1
  fi
  cp openbot-zh-*.service openbot-zh-*.timer /etc/systemd/system/
  systemctl daemon-reload
  systemctl enable --now openbot-zh-routines.timer openbot-zh-attachments.timer
fi
echo 'ChisaBot is bound to 127.0.0.1:3001. Configure the HTTPS gateway before public access.'
