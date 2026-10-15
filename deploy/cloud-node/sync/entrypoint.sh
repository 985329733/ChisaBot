#!/bin/sh
# 同步边车入口：第一次启动生成主机密钥（放在边车自己的卷 /sshhost），公钥另写一份到 /sync-pub 给节点读（电脑端固定主机身份）。
set -eu
[ -s /sshhost/ssh_host_ed25519_key ] || ssh-keygen -q -t ed25519 -N '' -C chisabot-cloudnode-sync -f /sshhost/ssh_host_ed25519_key
chmod 600 /sshhost/ssh_host_ed25519_key
cp /sshhost/ssh_host_ed25519_key.pub /sync-pub/host_ed25519.pub.tmp && mv -f /sync-pub/host_ed25519.pub.tmp /sync-pub/host_ed25519.pub
[ -f /sync-keys/authorized_keys ] || echo "还没有电脑登记公钥（节点写 /sync-keys/authorized_keys）" >&2
exec /usr/sbin/sshd -D -e -f /etc/chisabot-sync/sshd_config
