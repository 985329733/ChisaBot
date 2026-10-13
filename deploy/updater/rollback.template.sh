#!/bin/sh
# Roll back @NEW@ to @PREV@ (written by chisabot-updater, job @JOB@; docs/online-update.md).
# Only the image changes; the database is not reverted. The pre-update dump is in /opt/chisabot-updater/backups/.
set -eu
cd @COMPOSE_DIR@
exec 9>.deploy.lock
flock -w 60 9
if [ -f .image.before-@NEW_TAG@ ]; then
  # deploy/start.sh deployment: the image lives in .env (CHISABOT_IMAGE), compose.yaml is the repository's.
  if grep -q '^CHISABOT_IMAGE=' .env; then
    sed -i "s#^CHISABOT_IMAGE=.*#CHISABOT_IMAGE=@PREV@#" .env
  else
    printf 'CHISABOT_IMAGE=%s\n' @PREV@ >> .env
  fi
  grep -q "^CHISABOT_IMAGE=@PREV@\$" .env
else
  if [ -f @COMPOSE_FILE@.before-@NEW_TAG@ ]; then
    cp -p @COMPOSE_FILE@.before-@NEW_TAG@ @COMPOSE_FILE@
  else
    sed -i "s#image: @NEW@#image: @PREV@#" @COMPOSE_FILE@
  fi
  grep -q "image: @PREV@" @COMPOSE_FILE@
fi
docker compose -p @PROJECT@ -f @COMPOSE_FILE@ up -d --no-deps --pull never --wait --wait-timeout 180 @SERVICE@
docker inspect -f '{{.State.Health.Status}} restarts={{.RestartCount}} image={{.Config.Image}}' @CONTAINER@
curl -fsS -o /dev/null -w 'local /health %{http_code}\n' @LOCAL_URL@/health || true
PUBLIC='@PUBLIC_HEALTH_URL@'
[ -z "$PUBLIC" ] || curl -ksS -o /dev/null -w "$PUBLIC %{http_code}\n" "$PUBLIC" || true
echo ROLLBACK_DONE
