#!/bin/sh
# 云端工作区节点的出口限制（docs/cloud-claude-code.md §5.2）：这个网桥网段只能出公网。
#   sudo sh firewall.sh 172.29.0.0/16        加规则（重复运行不会重复加）
#   sudo sh firewall.sh 172.29.0.0/16 remove 去掉
# DOCKER-USER：丢弃这个网段发往 10/8、172.16/12、192.168/16、100.64/10、169.254/16（其他容器、内网、云厂商元数据）的转发；
# INPUT：丢弃这个网段发往主机本身的流量（主机上的任何端口都连不上，包括 ChisaBot 自己的 127.0.0.1 端口）。
# DNS 例外：允许发往 1.1.1.1 的 53（容器用公共 DNS）。重启后要重新运行（或放进开机脚本）。
set -eu
NET="${1:?用法：firewall.sh <网段> [remove]}"
ACTION="${2:-add}"
rule() { # table chain args...
  T=$1; C=$2; shift 2
  if iptables -t "$T" -C "$C" "$@" 2>/dev/null; then
    [ "$ACTION" = remove ] && iptables -t "$T" -D "$C" "$@"
  else
    [ "$ACTION" = add ] && iptables -t "$T" -I "$C" "$@"
  fi
  return 0
}
for DST in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10 169.254.0.0/16; do
  rule filter DOCKER-USER -s "$NET" -d "$DST" -m comment --comment chisabot-cloudnode -j DROP
done
# 同网段内部（容器之间）也不许互相访问
rule filter DOCKER-USER -s "$NET" -d "$NET" -m comment --comment chisabot-cloudnode -j DROP
# 已建立的回包放行（DOCKER-USER 最前面）
rule filter DOCKER-USER -s "$NET" -m conntrack --ctstate RELATED,ESTABLISHED -m comment --comment chisabot-cloudnode -j RETURN
rule filter INPUT -s "$NET" -m comment --comment chisabot-cloudnode -j DROP
echo "firewall $ACTION done for $NET"
