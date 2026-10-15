# 云端工作区节点（cloud-node）

服务器上一个独立的容器，里面是 Claude Code CLI 和 `chisabot-node`。配对后在 ChisaBot 里叫「云端工作区」，网页和手机上的
Claude Code 标签页就在它里面写代码（设计见 [docs/cloud-claude-code.md](../../docs/cloud-claude-code.md)，决定见 ADR-0014）。

## 安全边界

- 非 root（uid 1000，用户 `agent`），`cap_drop: ALL`，`no-new-privileges`，根文件系统只读，`/tmp` 是 tmpfs，2 核 / 4 GB / 512 个进程。
- 不挂 docker.sock，不用 host 网络，不发布任何端口。
- 配对时带 `--no-full-access`：本机永远拒绝完全访问；服务器也拒绝给云端工作区开完全访问。
- 独占一个 Docker 网桥，`firewall.sh` 丢弃这个网段发往私有网段（其他容器、内网、元数据地址）和主机的流量。节点只能出公网，
  连 ChisaBot 也走公网地址。
- 两个卷：`home`（Claude 凭据 `~/.claude/.credentials.json`、节点配置 `~/.chisabot-node/config.json`，都是 600）和 `workspace`
  （`projects/<工作区>/…`）。

## 部署

```sh
# 1. 镜像（Claude Code 版本固定，升级时改 CLAUDE_CODE_VERSION 重新构建）
docker build -t chisabot-cloudnode:2.1.165 --build-arg CLAUDE_CODE_VERSION=2.1.165 deploy/cloud-node

# 2. 网桥（可以复用一个空闲的），再加防火墙
docker network create chisabot-cloudnode-net        # 记下网段：docker network inspect chisabot-cloudnode-net
sudo sh deploy/cloud-node/firewall.sh 172.29.0.0/16

# 3. 安装码：ChisaBot 网页 设置 → 设备 → 添加设备 → 服务器，复制 cbp_ 开头的安装码（一次性）
CHISABOT_SERVER=https://你的域名:8443 CHISABOT_PAIR_CODE=cbp_xxx \
  docker compose -f deploy/cloud-node/compose.yaml up -d
```

第一次启动用安装码配对，以后重启直接用 home 卷里的设备令牌；每次启动都从服务器下载最新的 `chisabot-node.cjs`。

## 登录 Claude

ChisaBot 网页：设置 → 云端工作区 →「用 Claude 订阅登录」→ 打开授权页 → 用你的 Claude 账号授权 → 复制授权码粘回来 →「完成登录」。
授权码只经过节点上 `claude auth login` 进程的标准输入，不进 ChisaBot 的数据库和日志。

## 验收（部署后）

```sh
docker exec chisabot-cloudnode id -u                    # 1000
docker exec chisabot-cloudnode ls /var/run/docker.sock  # 不存在
docker port chisabot-cloudnode                          # 空
docker exec chisabot-cloudnode curl -m 5 http://172.17.0.1:80   # 失败（主机 / 其他容器都连不上）
```

## 停用

`docker compose -f deploy/cloud-node/compose.yaml down`（卷保留）；在 设置 → 设备 撤销这台设备；`firewall.sh <网段> remove`。
