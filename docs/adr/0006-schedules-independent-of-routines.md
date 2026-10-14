# ADR-0006：定时任务独立实现，不依赖上游 routines

- 状态：已采纳
- 日期：2026-10-14
- 相关：DESIGN.md §55；docs/schedules.md；瘦身 P4c ④

## 背景

Hark parity 第 6 项：对话里设提醒 / 周期任务，到点回到那段对话。上游有 routines / responsibilities，但它们是为企业「长期职责」
设计的，生产上曾经根本不触发（没有 worker），而且在瘦身计划里。

## 决定

- 新模块 `server/src/schedules/`，表 `chisabot_schedules` / `chisabot_schedule_runs`（开机建表），只依赖 `cron-parser`。
- 进程内每 15 秒扫描；`next_run_at` 的比较交换和插入运行记录在同一条语句里，多容器 / 新旧容器并存也不重复触发。
- 到点向原对话发一条标记消息，机器人回答；对话忙就进收件箱；IM 来的任务推回 IM。
- 停机错过：周期任务晚 >30 分钟跳过，一次性提醒 ≤6 小时照发并注明。
- 上游 `schedule_follow_up`（机器人给自己设的回访）暂时保留。

## 后果

- 瘦身删掉 routines / responsibilities 不会影响定时任务。
- P4c 时把 wake-up 并入定时任务，最终只剩一套调度。
