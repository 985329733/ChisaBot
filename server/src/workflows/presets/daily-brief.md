---
format: chisabot.workflow/v1
slug: daily-brief
name: 每日简报
description: 资讯员收集你关注领域过去一天的动态，编辑整理成 3 分钟读完的简报。
icon: 📰
version: "1.0"
tags:
  - 资讯
bots:
  - key: scout
    name: 资讯员
    description: 搜集最新动态，记录标题、要点和来源链接。
  - key: editor
    name: 编辑
    description: 筛选、排序、改写成简洁好读的简报。
inputs:
  - key: topics
    label: 关注领域
    type: text
    required: true
    default: AI、科技、财经
  - key: city
    label: 城市（天气）
    type: text
    placeholder: 可选，例如：上海
  - key: count
    label: 条数
    type: number
    default: 8
steps:
  - id: gather
    name: 收集动态
    bot: scout
    tools:
      allow:
        - computer
        - apps
    prompt: |-
      收集过去 24 小时「{{inputs.topics}}」领域最重要的 {{inputs.count}} 条动态。每条写：标题、一句话要点、来源链接、发布时间。
      如果填了城市「{{inputs.city}}」，再查今天的天气（气温、降水、提醒）。
      不能联网时如实说明，只写你确定的内容，不要编造新闻。
  - id: brief
    name: 编写简报
    bot: editor
    prompt: |-
      把资讯员的素材写成一份 3 分钟能读完的简报（Markdown）：
      - 开头「今日要点」3 条；
      - 按领域分组列出动态，每条一行，保留来源链接；
      - 有天气就加「天气」一节；
      - 结尾「值得关注」1–2 条。
      素材里没有的内容不要补。
constraints:
  maxSteps: 2
  maxTokens: 60000
  timeLimitMinutes: 20
  tools:
    deny:
      - devices
      - host
      - memory
      - handoff
  output:
    format: markdown
---

# 每日简报

可以每天手动运行，也可以在聊天里说「每天早上 8 点运行每日简报工作流」让机器人建一个定时任务。
