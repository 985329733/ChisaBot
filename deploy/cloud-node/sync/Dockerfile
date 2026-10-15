# 同步边车 cloudnode-sync（docs/cloud-claude-code.md §5.3）：uid 1000 的 sshd（只听 127.0.0.1:2222，和节点共用网络命名空间，
# 不发布端口）+ 自己编译的 MIT 版 mutagen-agent（不加 mutagensspl 标签）+ chisabot-sync-gate（只放行 Mutagen 同步 agent 和
# 这个工作区的 git upload-pack / receive-pack）。
#   docker build -t chisabot-cloudnode-sync:0.18.1 deploy/cloud-node/sync
FROM golang:1.24-bookworm AS mutagen
ARG MUTAGEN_VERSION=v0.18.1
RUN git clone -q --depth 1 --branch "${MUTAGEN_VERSION}" https://github.com/mutagen-io/mutagen.git /src
WORKDIR /src
# 不带 mutagensspl 标签 = 只有 MIT 和其他非 copyleft 代码（Mutagen LICENSE）
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -tags mutagenagent -o /out/mutagen-agent ./cmd/mutagen-agent \
 && /out/mutagen-agent version \
 && cp LICENSE /out/MUTAGEN-LICENSE

FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssh-server git ca-certificates tini \
 && rm -rf /var/lib/apt/lists/* /etc/ssh/ssh_host_* \
 && useradd -u 1000 -m -d /home/agent -s /bin/sh agent \
 && mkdir -p /run/sshd /home/agent/.mutagen /sshhost /sync-keys /sync-pub /workspace/projects \
 && chown agent:agent /home/agent/.mutagen /sshhost /sync-keys /sync-pub /workspace /workspace/projects
COPY --from=mutagen /out/mutagen-agent /opt/mutagen/mutagen-agent
COPY --from=mutagen /out/MUTAGEN-LICENSE /opt/mutagen/LICENSE
COPY sshd_config /etc/chisabot-sync/sshd_config
COPY gate.sh /usr/local/bin/chisabot-sync-gate
COPY entrypoint.sh /usr/local/bin/chisabot-sync-entrypoint
RUN chmod 755 /usr/local/bin/chisabot-sync-gate /usr/local/bin/chisabot-sync-entrypoint /opt/mutagen/mutagen-agent
ENV HOME=/home/agent LANG=C.UTF-8
USER agent
WORKDIR /home/agent
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/chisabot-sync-entrypoint"]
