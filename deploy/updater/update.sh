#!/bin/bash
# ChisaBot 宿主机更新程序：一次更新（docs/online-update.md）。
#
# 由 chisabot-updater.py 以 root 调用（管理后台 → 系统更新 → 更新），也可以手动运行：
#   update.sh --job <id> --target <40 位提交> [--dry-run] [--build-only] [--tag <镜像标签>]
#
#   --dry-run     备份、构建前端、构建镜像，然后在切换之前停下（不动正在运行的容器）。
#   --build-only  只构建镜像（不备份、不切换），给手动部署用。
#   --tag         镜像标签；默认 auto-<UTC 时间>-<提交前 7 位>。
#
# 步骤（每步打印 "::step:: <key>"，key 与 shared/system-update.ts 的 UPDATE_STEPS 一致）：
#   prepare → deps → backup → frontend → image → swap → health → done
# 最后一行一定是 "::result:: succeeded|failed|rolled_back"（被中断时由 trap 写 failed）。
#
# 镜像的做法和手动发布一样（127 层上限）：FROM 压平的底座（BASE_IMAGE），只覆盖 app/dist、server/src、
# server/drizzle、server/scripts、shared、examples/zh-CN、agent-computer/src 和 build-info.json，层数固定。依赖（bun.lock、
# package.json）、Dockerfile、docker/ 有变化时一键更新做不了 —— deps 一步会停下，需要完整构建新底座。
# 内存只有 7.6 GB、没有 swap：前端构建在限内存的容器里跑，构建期间停掉原型沙箱，结束后（含失败）恢复。
set -uo pipefail
U=/opt/chisabot-updater
# shellcheck source=/dev/null
. "$U/config.env"

JOB="" TARGET="" DRY=0 BUILD_ONLY=0 TAG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --job) JOB="$2"; shift 2 ;;
    --target) TARGET="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    --build-only) BUILD_ONLY=1; shift ;;
    --tag) TAG="$2"; shift 2 ;;
    *) echo "未知参数 $1"; exit 64 ;;
  esac
done

RESULT=failed
PROTO_STOPPED=""
finish() {
  if [ -n "$PROTO_STOPPED" ]; then
    for c in $PROTO_STOPPED; do docker start "$c" >/dev/null 2>&1 && echo "原型沙箱 $c 已恢复"; done
    PROTO_STOPPED=""
  fi
  echo "::result:: $RESULT"
}
trap finish EXIT
trap 'echo "::error:: 被中断"; exit 130' INT TERM

step() { echo "::step:: $1"; echo "[$(date '+%H:%M:%S')] $2"; }
fail() { echo "::error:: $*"; exit 2; }
G() { git --git-dir="$U/mirror.git" "$@"; }

case "$JOB" in ''|*[!A-Za-z0-9_-]*) fail "任务 id 无效" ;; esac
case "$TARGET" in *[!0-9a-f]*|'') fail "目标提交无效" ;; esac
[ ${#TARGET} -eq 40 ] || fail "目标提交必须是 40 位"

exec 9>"$U/update.lock"
flock -n 9 || fail "已经有一个更新或回滚在进行"

# ---------- prepare ----------
step prepare "准备：目标 ${TARGET:0:7}"
G cat-file -e "${TARGET}^{commit}" 2>/dev/null || fail "本机镜像里没有提交 ${TARGET:0:7}"
MAIN=$(G rev-parse refs/heads/main) || fail "本机镜像里没有 main"
if [ "$TARGET" != "$MAIN" ] && ! G merge-base --is-ancestor "$TARGET" "$MAIN"; then
  fail "提交 ${TARGET:0:7} 不在 main 上"
fi
CUR_IMAGE=$(docker inspect -f '{{.Config.Image}}' "$CONTAINER" 2>/dev/null) || fail "找不到正在运行的容器 $CONTAINER"
CUR_TAG=${CUR_IMAGE##*:}
[ -n "$TAG" ] || TAG="auto-$(date -u +%Y%m%d%H%M)-${TARGET:0:7}"
case "$TAG" in *[!A-Za-z0-9._-]*) fail "镜像标签无效" ;; esac
NEW_IMAGE="$IMAGE_REPO:$TAG"
[ "$NEW_IMAGE" != "$CUR_IMAGE" ] || fail "新镜像标签和当前一样"
echo "当前 $CUR_IMAGE → 新 $NEW_IMAGE"
echo "::from:: $CUR_IMAGE"
echo "::to:: $NEW_IMAGE"
AVAIL_KB=$(df -Pk /var/lib/docker | awk 'NR==2{print $4}')
[ "${AVAIL_KB:-0}" -gt 2500000 ] || fail "磁盘剩余不足 2.5 GB（$((AVAIL_KB/1024)) MB），先清理再更新"

# ---------- deps ----------
step deps "检查依赖与底座"
FP=$(bash "$U/deps-fingerprint.sh" "$TARGET") || fail "无法计算依赖指纹"
if [ "$FP" != "$(cat "$U/base-deps.sha256" 2>/dev/null)" ]; then
  fail "这次更新改动了依赖（bun.lock / package.json）或 Dockerfile / docker/，一键更新做不了，需要完整构建新底座"
fi
docker image inspect "$BASE_IMAGE" >/dev/null 2>&1 || fail "底座镜像 $BASE_IMAGE 不存在"
echo "依赖未变，底座 $BASE_IMAGE"

# ---------- backup ----------
if [ "$BUILD_ONLY" = 1 ]; then
  step backup "只构建镜像：跳过备份"
else
  step backup "备份数据库与 compose"
  BK="$U/backups/$(date -u +%Y%m%dT%H%M%SZ)-$JOB"
  mkdir -p "$BK"
  docker exec "$CONTAINER" sh -c 'pg_dump -Fc "$(cat /run/s6/container_environment/DATABASE_URL)"' > "$BK/openbot.dump" \
    || fail "pg_dump 失败"
  [ -s "$BK/openbot.dump" ] || fail "数据库备份是空的"
  cp -p "$COMPOSE_DIR/$COMPOSE_FILE" "$BK/compose.yaml"
  for v in profiles workspace; do
    tar czf "$BK/$v-volume.tgz" -C "/var/lib/docker/volumes/${PROJECT}_$v" _data 2>/dev/null || echo "（卷 $v 未备份）"
  done
  echo "$CUR_IMAGE" > "$BK/image.txt"
  echo "::backup:: $BK"
  echo "数据库备份 $(stat -c %s "$BK/openbot.dump") 字节 → $BK"
fi

# ---------- frontend ----------
step frontend "导出源码并构建前端（限内存 $BUILD_MEMORY）"
B="$U/build"
rm -rf "$B" && mkdir -p "$B/src" || fail "无法准备构建目录"
G archive "$TARGET" | tar -x -C "$B/src" || fail "导出源码失败"
cp -al "$NODE_MODULES_BASE" "$B/src/node_modules" || fail "准备 node_modules 失败"
VERSION=$(sed -n 's/^  "version": "\([^"]*\)".*/\1/p' "$B/src/package.json" | head -n 1)
BUILT_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
printf '{"version":"%s","commit":"%s","buildId":"%s","builtAt":"%s","image":"%s"}\n' \
  "${VERSION:-0.0.0}" "$TARGET" "$TAG" "$BUILT_AT" "$NEW_IMAGE" > "$B/build-info.json"
for c in $PROTO_CONTAINERS; do
  if [ "$(docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null)" = "true" ]; then
    docker stop "$c" >/dev/null 2>&1 && PROTO_STOPPED="$PROTO_STOPPED $c" && echo "构建期间暂停原型沙箱 $c"
  fi
done
docker run --rm --memory "$BUILD_MEMORY" --memory-swap "$BUILD_MEMORY" --network none \
  -v "$B/src:/src" -e VITE_CHISABOT_BUILD_ID="$TAG" -e VITE_MAGPIE_MANAGEMENT_URL="$VITE_MAGPIE_MANAGEMENT_URL" \
  --entrypoint sh "$CUR_IMAGE" -c '
cd /src && bun scripts/generate-app-config.ts >/dev/null 2>&1 || echo "（generate-app-config 未成功，使用仓库里的配置）"
# routeTree.gen.ts 由 vite 的 TanStack Router 插件在构建时重新生成。
cd app && rm -rf dist && NODE_OPTIONS=--max-old-space-size=2800 node ../node_modules/vite/bin/vite.js build > /tmp/vite.log 2>&1
code=$?
grep -v "^dist\|^ *dist" /tmp/vite.log | tail -n 12
exit $code
' || fail "前端构建失败"
for c in $PROTO_STOPPED; do docker start "$c" >/dev/null 2>&1 && echo "原型沙箱 $c 已恢复"; done
PROTO_STOPPED=""
[ -f "$B/src/app/dist/index.html" ] || fail "前端构建没有产出 index.html"
grep -rqF "$TAG" "$B/src/app/dist/assets" || fail "前端产物里没有构建号 $TAG"
echo "前端构建完成"

# ---------- image ----------
step image "构建镜像 $NEW_IMAGE（底座 $BASE_IMAGE）"
C="$B/ctx"
mkdir -p "$C/app" "$C/server" "$C/examples" "$C/agent-computer"
cp -a "$B/src/app/dist" "$C/app/dist"
cp -a "$B/src/server/src" "$B/src/server/drizzle" "$B/src/server/scripts" "$C/server/"
cp -a "$B/src/shared" "$C/shared"
cp -a "$B/src/examples/zh-CN" "$C/examples/zh-CN"
cp -a "$B/src/agent-computer/src" "$C/agent-computer/src"
cp -p "$B/build-info.json" "$C/build-info.json"
sed -e "s#@BASE_IMAGE@#$BASE_IMAGE#" -e "s#@COMMIT@#$TARGET#g" -e "s#@TAG@#$TAG#g" -e "s#@VERSION@#${VERSION:-0.0.0}#g" \
  "$U/Dockerfile.update" > "$C/Dockerfile" || fail "生成 Dockerfile 失败"
docker build -q -t "$NEW_IMAGE" "$C" || fail "镜像构建失败"
LAYERS=$(docker image inspect -f '{{len .RootFS.Layers}}' "$NEW_IMAGE")
echo "镜像 $NEW_IMAGE 构建完成（$LAYERS 层）"
echo "::image:: $NEW_IMAGE"

if [ "$BUILD_ONLY" = 1 ] || [ "$DRY" = 1 ]; then
  [ "$DRY" = 1 ] && echo "::dry-run:: 在切换前停下；正在运行的仍是 $CUR_IMAGE"
  step done "完成（未切换）"
  rm -rf "$B"
  RESULT=succeeded
  exit 0
fi

# ---------- swap ----------
step swap "切换到 $NEW_IMAGE"
RB="$COMPOSE_DIR/rollback-to-$CUR_TAG.sh"
sed -e "s#@NEW@#$NEW_IMAGE#g" -e "s#@NEW_TAG@#$TAG#g" -e "s#@PREV@#$CUR_IMAGE#g" -e "s#@JOB@#$JOB#g" \
  -e "s#@COMPOSE_DIR@#$COMPOSE_DIR#g" -e "s#@COMPOSE_FILE@#$COMPOSE_FILE#g" -e "s#@PROJECT@#$PROJECT#g" \
  -e "s#@SERVICE@#$SERVICE#g" -e "s#@CONTAINER@#$CONTAINER#g" "$U/rollback.template.sh" > "$RB.tmp" && chmod 755 "$RB.tmp" && mv "$RB.tmp" "$RB" \
  || fail "写回滚脚本失败"
echo "回滚脚本 $RB"
echo "::rollback:: $RB"
(
  cd "$COMPOSE_DIR" || exit 1
  exec 8>.deploy.lock
  flock -w 60 8 || { echo "拿不到 $COMPOSE_DIR/.deploy.lock"; exit 1; }
  cp -p "$COMPOSE_FILE" "$COMPOSE_FILE.before-$TAG"
  sed -i "s#^\(    image: \)$IMAGE_REPO:[A-Za-z0-9._-]*#\1$NEW_IMAGE#" "$COMPOSE_FILE"
  grep -q "image: $NEW_IMAGE\$" "$COMPOSE_FILE" || { cp -p "$COMPOSE_FILE.before-$TAG" "$COMPOSE_FILE"; echo "compose 里没有找到镜像行"; exit 1; }
  docker compose -p "$PROJECT" -f "$COMPOSE_FILE" config --quiet || { cp -p "$COMPOSE_FILE.before-$TAG" "$COMPOSE_FILE"; exit 1; }
  docker compose -p "$PROJECT" -f "$COMPOSE_FILE" up -d --no-deps --pull never --wait --wait-timeout 180 "$SERVICE"
)
SWAP=$?

# ---------- health ----------
step health "健康检查"
OK=0
if [ "$SWAP" = 0 ] && bash "$U/health.sh" "$NEW_IMAGE" "$TAG"; then OK=1; fi
if [ "$OK" != 1 ]; then
  echo "::error:: 新版本健康检查没通过，自动回滚到 $CUR_IMAGE"
  if sh "$RB" && bash "$U/health.sh" "$CUR_IMAGE" ""; then
    echo "已回滚到 $CUR_IMAGE"
    RESULT=rolled_back
    exit 3
  fi
  echo "::error:: 自动回滚后仍不健康，请人工处理（回滚脚本 $RB，备份 ${BK:-无}）"
  exit 4
fi

# ---------- done ----------
step done "完成：$NEW_IMAGE 已上线"
rm -rf "$B"
# 只保留最近 KEEP_IMAGES 个一键更新镜像（不动正在用的、上一版、底座和手动发布的 glass-*）。
docker images --format '{{.Repository}}:{{.Tag}} {{.CreatedAt}}' "$IMAGE_REPO" | awk '$1 ~ /:auto-/' | sort -k2 -r | awk '{print $1}' \
  | tail -n +"$((KEEP_IMAGES + 1))" | while read -r img; do
    if [ "$img" != "$NEW_IMAGE" ] && [ "$img" != "$CUR_IMAGE" ] && docker rmi "$img" >/dev/null 2>&1; then echo "清理旧镜像 $img"; fi
  done
ls -1dt "$U"/backups/*/ 2>/dev/null | tail -n +"$((KEEP_BACKUPS + 1))" | xargs -r rm -rf
docker image prune -f >/dev/null 2>&1
RESULT=succeeded
exit 0
