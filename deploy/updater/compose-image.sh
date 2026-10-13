#!/bin/bash
# 镜像写在哪（update.sh / rollback.sh 用 source 引入；docs/online-update.md）。
#
# 两种部署：
#  - compose 模式：compose 文件里直接写 `    image: local/chisabot:<标签>`（手写的 /opt/openbot-zh/compose.yaml）。
#    切换 = 改这一行；上线前的 compose 留成 <compose>.before-<新标签>。
#  - env 模式：仓库自带的 deploy/compose.yaml 写的是 `image: ${CHISABOT_IMAGE:-…}`（deploy/start.sh 部署的）。
#    compose 文件在 git 仓库里，不能改；切换 = 改同目录 .env 的 CHISABOT_IMAGE（compose 自动读它）；
#    上一版镜像名记在 .image.before-<新标签>。
# 需要 COMPOSE_DIR、COMPOSE_FILE、IMAGE_REPO（config.env）。

image_mode() {
  # shellcheck disable=SC2016  # 找的就是字面的 ${CHISABOT_IMAGE
  if grep -q '^    image: \${CHISABOT_IMAGE' "$COMPOSE_DIR/$COMPOSE_FILE" 2>/dev/null; then echo env; else echo compose; fi
}

# set_image <镜像>：把部署指向这个镜像（不启动）。成功返回 0。
set_image() {
  local f
  if [ "$(image_mode)" = env ]; then
    f="$COMPOSE_DIR/.env"
    if grep -q '^CHISABOT_IMAGE=' "$f" 2>/dev/null; then
      sed -i "s#^CHISABOT_IMAGE=.*#CHISABOT_IMAGE=$1#" "$f"
    else
      printf 'CHISABOT_IMAGE=%s\n' "$1" >> "$f"
    fi
    grep -q "^CHISABOT_IMAGE=$1\$" "$f"
  else
    f="$COMPOSE_DIR/$COMPOSE_FILE"
    sed -i "s#^\(    image: \)$IMAGE_REPO:[A-Za-z0-9._-]*#\1$1#" "$f"
    grep -q "^    image: $1\$" "$f"
  fi
}

# previous_image <标签>：<标签> 上线之前的镜像（不知道时输出空）。
previous_image() {
  if [ -f "$COMPOSE_DIR/.image.before-$1" ]; then
    sed -n "1s#^\($IMAGE_REPO:[A-Za-z0-9._-]*\)\$#\1#p" "$COMPOSE_DIR/.image.before-$1"
  elif [ -f "$COMPOSE_DIR/$COMPOSE_FILE.before-$1" ]; then
    sed -n "s#^    image: \($IMAGE_REPO:[A-Za-z0-9._-]*\)\$#\1#p" "$COMPOSE_DIR/$COMPOSE_FILE.before-$1" | head -n 1
  fi
}
