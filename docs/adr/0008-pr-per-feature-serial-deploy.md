# ADR-0008：一个功能一个 PR，合并后串行部署；做好一版就发

- 状态：已采纳
- 日期：2026-10-12（PR 流程）、2026-10-13（「bot做好一版就发」）、2026-10-14（并行 + 串行部署）
- 相关：CONTRIBUTING.md；docs/dev/parallel-work.md；docs/ops/deploy.md

## 背景

- 2026-10-12：用户要求每个修复都走 GitHub PR 再合并。
- 2026-10-13 15:13：「bot做好一版就发」——完成并验证的版本直接合并、部署、发布，不再逐个等确认。
- 2026-10-14：「并发推进」——多个功能并行开发，部署会互相撞。
- 2026-10-14 15:27：main 被强推，PR #84–#92 被抹掉。

## 决定

- 每个功能 / 修复一个分支一个 PR（merge commit 合并），PR 里同时更新 docs、DESIGN.md、CHANGELOG、BACKLOG / ROADMAP。
- 合并前一刻 rebase 到最新 main；只对自己的分支 force-with-lease；**永远不 force-push main**。
- 部署只走 `deploy-serial.sh`（flock + 等空闲 + updater 队列）；上线后跑自检，必要时一次性机器人 e2e。
- 验证完的版本直接发；纯文档 PR 不部署。

## 后果

- main 永远可部署，每次上线都有回滚脚本对应一个合并提交。
- 并行时排队部署可能要等几分钟。
