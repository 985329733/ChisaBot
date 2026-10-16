# 云端工作区节点（docs/cloud-claude-code.md §5.1，ADR-0014）：Claude Code CLI + chisabot-node，非 root。
# 构建：docker build -t chisabot-cloudnode:2.1.165 --build-arg CLAUDE_CODE_VERSION=2.1.165 deploy/cloud-node
FROM node:22-bookworm-slim
ARG CLAUDE_CODE_VERSION=2.1.165
# 「Claude 上游代理」的节点链接转换（DESIGN.md §85）：固定版本的 sing-box，sha256 对过官方发布页才装
ARG SINGBOX_VERSION=1.14.3
ARG SINGBOX_SHA256_AMD64=e2bdf179c15a3652955dc44867e33ca0965c9c9b91b34267dcc5a5d639a5feee
ARG SINGBOX_SHA256_ARM64=29dae24d76bea3bc62d07dd3e60cfc12003de7debbd6b768df9be9c68360174e
ARG TARGETARCH
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ripgrep procps ca-certificates curl tini python3 \
    # 「在云端完成登录」的无头浏览器（和 Claude Code 同一个出口）+ 中文字体
    chromium fonts-noto-cjk \
 && rm -rf /var/lib/apt/lists/* \
 && arch="${TARGETARCH:-$(dpkg --print-architecture)}" \
 && case "$arch" in amd64) sum="$SINGBOX_SHA256_AMD64" ;; arm64) sum="$SINGBOX_SHA256_ARM64" ;; *) echo "sing-box: 不支持的架构 $arch" && exit 1 ;; esac \
 && curl -fsSL --retry 3 -o /tmp/sing-box.tgz "https://github.com/SagerNet/sing-box/releases/download/v${SINGBOX_VERSION}/sing-box-${SINGBOX_VERSION}-linux-${arch}.tar.gz" \
 && echo "${sum}  /tmp/sing-box.tgz" | sha256sum -c - \
 && tar -xzf /tmp/sing-box.tgz -C /tmp \
 && install -m 755 "/tmp/sing-box-${SINGBOX_VERSION}-linux-${arch}/sing-box" /usr/local/bin/sing-box \
 && rm -rf /tmp/sing-box.tgz "/tmp/sing-box-${SINGBOX_VERSION}-linux-${arch}" \
 && /usr/local/bin/sing-box version \
 && npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
 && npm cache clean --force \
 && rm -rf /root/.npm /tmp/* \
 # node 镜像自带的 uid 1000 用户改名为 agent，home = /home/agent（挂 home 卷）
 && usermod -l agent -d /home/agent -m node \
 && groupmod -n agent node \
 && mkdir -p /workspace /sync-keys /sync-pub && chown agent:agent /workspace /sync-keys /sync-pub
COPY entrypoint.sh /usr/local/bin/cloudnode-entrypoint
RUN chmod 755 /usr/local/bin/cloudnode-entrypoint
ENV HOME=/home/agent \
    CHISABOT_CLOUD_WORKSPACE=1 \
    CHISABOT_CC_ROOT=/workspace \
    CHISABOT_NODE_DIR=/home/agent/.chisabot-node \
    DISABLE_AUTOUPDATER=1 \
    CHISABOT_CHROMIUM=/usr/bin/chromium \
    CHISABOT_SINGBOX=/usr/local/bin/sing-box \
    LANG=C.UTF-8
USER agent
WORKDIR /workspace
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/cloudnode-entrypoint"]
