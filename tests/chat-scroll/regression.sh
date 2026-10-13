#!/bin/sh
# 聊天滚动回归（DESIGN.md §35.4、§42.7）：send-jump.mjs 的必过场景，任何一项不过退出码 1。
# 用法：BASE=… BOT=… THREAD=… [NODE=node] [CASES="wide narrow …"] sh tests/chat-scroll/regression.sh
D=$(dirname "$0")
N=${NODE:-node}
CASES=${CASES:-"wide narrow failtwice narrowfail polltick narrowpoll up"}
fail=0
for c in $CASES; do
  case $c in
    wide) set -- ;;
    narrow) set -- W=420 H=860 ;;
    failtwice) set -- FAIL=1 TWICE=1 ;;
    narrowfail) set -- W=420 H=860 FAIL=1 TWICE=1 ;;
    polltick) set -- POLLTICK=1 TWICE=1 ;;
    narrowpoll) set -- W=420 H=860 POLLTICK=1 TWICE=1 ;;
    up) set -- SCROLLUP=700 ;;
    *) echo "unknown case $c"; fail=1; continue ;;
  esac
  if env ASSERT=1 TAG="$c" "$@" "$N" "$D/send-jump.mjs" > "/tmp/send-jump-$c.log" 2>&1; then echo "PASS $c"; else echo "FAIL $c (/tmp/send-jump-$c.log)"; fail=1; fi
  grep -E "SCREENJUMPS|REMOVED|POLLTICK|PASS send|FAIL send" "/tmp/send-jump-$c.log" | cut -c1-400
done
exit $fail
