#!/bin/sh
# Roll back @NEW@ to @PREV@ (written by chisabot-updater, job @JOB@; docs/online-update.md).
# Only the image changes; the database is not reverted. The pre-update dump is in /opt/chisabot-updater/backups/.
set -eu
cd @COMPOSE_DIR@
exec 9>.deploy.lock
flock -w 60 9
if [ -f @COMPOSE_FILE@.before-@NEW_TAG@ ]; then
  cp -p @COMPOSE_FILE@.before-@NEW_TAG@ @COMPOSE_FILE@
else
  sed -i "s#image: @NEW@#image: @PREV@#" @COMPOSE_FILE@
fi
grep -q "image: @PREV@" @COMPOSE_FILE@
docker compose -p @PROJECT@ -f @COMPOSE_FILE@ up -d --no-deps --pull never --wait --wait-timeout 180 @SERVICE@
docker inspect -f '{{.State.Health.Status}} restarts={{.RestartCount}} image={{.Config.Image}}' @CONTAINER@
curl -fsS -o /dev/null -w 'local /health %{http_code}\n' @LOCAL_URL@/health || true
curl -ksS -o /dev/null -w '@PUBLIC_HEALTH_URL@ %{http_code}\n' '@PUBLIC_HEALTH_URL@' || true
echo ROLLBACK_DONE
