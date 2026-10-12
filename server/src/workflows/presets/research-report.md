---
format: chisabot.workflow/v1
slug: research-report
name: 调研报告
description: 研究员查资料 → 撰稿人写报告 → 审校核对定稿。给一个主题，拿到一份带来源的报告。
icon: 🔎
version: "1.0"
tags:
  - 写作
  - 调研
bots:
  - key: researcher
    name: 研究员
    description: 负责查资料、核对来源，只写事实和出处，不写成文章。
  - key: writer
    name: 撰稿人
    description: 把资料写成结构清楚、读者能看懂的报告。
  - key: reviewer
    name: 审校
    description: 逐条核对报告和资料是否一致，修正事实、逻辑和语言问题。
skills:
  - slug: source-check
    title: 来源核查
    instructions: |-
      - 每条事实后面用 [来源](链接) 标出处；没有联网核实的写「（未联网核实）」。
      - 优先官方网站、原始论文、权威媒体；同一结论尽量有两个独立来源。
      - 数字要写清单位、口径和时间；不同来源说法不一致时并列写出，不要自己挑一个。
      - 不编造链接。拿不准的宁可不写。
  - slug: report-structure
    title: 报告结构
    instructions: |-
      报告按这个结构写（Markdown）：
      1. 标题
      2. 摘要（3–5 条要点）
      3. 背景
      4. 主要发现（分小节，每节先结论后论据）
      5. 风险与不确定性
      6. 结论与建议
      7. 参考来源（编号列表）
inputs:
  - key: topic
    label: 主题
    type: text
    required: true
    placeholder: 例如：2026 年固态电池的量产进展
  - key: audience
    label: 读者
    type: select
    options:
      - 大众读者
      - 专业人士
      - 管理层
    default: 大众读者
  - key: length
    label: 篇幅
    type: select
    options:
      - 简短（约 800 字）
      - 标准（约 2000 字）
      - 详细（约 4000 字）
    default: 标准（约 2000 字）
  - key: focus
    label: 特别关注
    type: textarea
    placeholder: 可选：希望重点回答的问题
steps:
  - id: collect
    name: 收集资料
    bot: researcher
    skills:
      - source-check
    tools:
      allow:
        - computer
        - apps
        - ui
    prompt: |-
      围绕「{{inputs.topic}}」收集资料。特别关注：{{inputs.focus}}

      能用云端浏览器就打开 3–6 个可靠来源阅读；不能联网时根据已有知识作答，并在每条后标注「（未联网核实）」。
      输出一份资料清单：关键事实（每条带出处）、关键数据、各方观点与分歧、仍不确定的地方。不要写成文章。
  - id: draft
    name: 撰写报告
    bot: writer
    skills:
      - report-structure
    prompt: |-
      根据研究员整理的资料，写一份关于「{{inputs.topic}}」的报告。
      读者：{{inputs.audience}}；篇幅：{{inputs.length}}。
      只使用资料里有的事实，保留出处链接；资料不足的地方直接说明，不要补编。
  - id: review
    name: 审校定稿
    bot: reviewer
    handoff: all
    skills:
      - source-check
    prompt: |-
      对照研究员的资料逐条核对撰稿人的草稿：修正与资料不符的事实和数字、补上漏掉的出处、理顺逻辑和语言。
      输出定稿全文（Markdown），最后加一节「审校说明」，用 3–6 条列出你改了什么。
constraints:
  maxSteps: 3
  maxTokens: 120000
  timeLimitMinutes: 30
  stepTimeoutMinutes: 5
  tools:
    deny:
      - devices
      - host
      - schedule
      - handoff
      - memory
  output:
    format: markdown
---

# 调研报告

三个角色依次接力：

1. **研究员**查资料（能联网就用云端浏览器），只整理事实和出处；
2. **撰稿人**按「报告结构」技能写成报告；
3. **审校**对照资料核对草稿，输出定稿和审校说明。

只有一个机器人也能跑：运行时把三个角色都交给同一个机器人即可，它会按角色分别完成每一步。
