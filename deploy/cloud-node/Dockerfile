# 云端工作区节点（docs/cloud-claude-code.md §5.1，ADR-0014）：Claude Code CLI + chisabot-node，非 root。
# 构建：docker build -t chisabot-cloudnode:2.1.165 --build-arg CLAUDE_CODE_VERSION=2.1.165 deploy/cloud-node
FROM node:22-bookworm-slim
ARG CLAUDE_CODE_VERSION=2.1.165
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ripgrep procps ca-certificates curl tini python3 \
    # 「在云端完成登录」的无头浏览器（和 Claude Code 同一个出口）+ 中文字体
    chromium fonts-noto-cjk \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
 && npm cache clean --force \
 && rm -rf /root/.npm /tmp/* \
 # node 镜像自带的 uid 1000 用户改名为 agent，home = /home/agent（挂 home 卷）
 && usermod -l agent -d /home/agent -m node \
 && groupmod -n agent node \
 && mkdir -p /workspace && chown agent:agent /workspace
COPY entrypoint.sh /usr/local/bin/cloudnode-entrypoint
RUN chmod 755 /usr/local/bin/cloudnode-entrypoint
ENV HOME=/home/agent \
    CHISABOT_CLOUD_WORKSPACE=1 \
    CHISABOT_CC_ROOT=/workspace \
    CHISABOT_NODE_DIR=/home/agent/.chisabot-node \
    DISABLE_AUTOUPDATER=1 \
    CHISABOT_CHROMIUM=/usr/bin/chromium \
    LANG=C.UTF-8
USER agent
WORKDIR /workspace
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/cloudnode-entrypoint"]
