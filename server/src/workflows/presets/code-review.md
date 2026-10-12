---
format: chisabot.workflow/v1
slug: code-review
name: 代码审查
description: 安全审查和质量审查并行进行，主审汇总成一份按严重程度排序的问题清单和合并建议。
icon: 🧑‍💻
version: "1.0"
tags:
  - 开发
bots:
  - key: security
    name: 安全审查员
    description: 只关注安全：注入、越权、密钥泄露、不安全的反序列化、依赖风险等。
  - key: quality
    name: 质量审查员
    description: 关注正确性、边界条件、错误处理、性能、可读性和测试。
  - key: lead
    name: 主审
    description: 汇总两位审查员的意见，去重、定级，给出是否可以合并的结论。
skills:
  - slug: review-format
    title: 审查意见格式
    instructions: |-
      每条问题写成：
      - 严重程度：严重 / 高 / 中 / 低
      - 位置：文件名和行号（看不出行号就写函数名或代码片段）
      - 问题：一句话说清楚
      - 建议：具体怎么改，必要时给出修改后的代码
      没发现问题就明确写「未发现问题」，不要为了凑数编问题。
inputs:
  - key: code
    label: 代码或 diff
    type: textarea
    required: true
    placeholder: 粘贴要审查的代码或 git diff
  - key: language
    label: 语言 / 框架
    type: text
    placeholder: 例如：TypeScript + React
  - key: focus
    label: 侧重点
    type: select
    options:
      - 全面
      - 安全优先
      - 性能优先
      - 可读性优先
    default: 全面
  - key: context
    label: 背景说明
    type: textarea
    placeholder: 可选：这段代码要做什么、改动的原因
steps:
  - id: security
    name: 安全审查
    bot: security
    group: review
    handoff: none
    skills:
      - review-format
    prompt: |-
      审查下面的代码（{{inputs.language}}），只找安全问题。侧重点：{{inputs.focus}}。背景：{{inputs.context}}

      ```
      {{inputs.code}}
      ```
  - id: quality
    name: 质量审查
    bot: quality
    group: review
    handoff: none
    skills:
      - review-format
    prompt: |-
      审查下面的代码（{{inputs.language}}），找正确性、边界条件、错误处理、性能、可读性和测试方面的问题（安全问题由别人负责）。侧重点：{{inputs.focus}}。背景：{{inputs.context}}

      ```
      {{inputs.code}}
      ```
  - id: summary
    name: 汇总结论
    bot: lead
    handoff: all
    prompt: |-
      汇总安全审查和质量审查的意见：合并重复项，重新核定严重程度，删掉站不住的意见。
      输出：
      1. 一张 Markdown 表格「严重程度 | 位置 | 问题 | 建议」，按严重程度从高到低；
      2. 结论：可以合并 / 修改后合并 / 不建议合并，附一句理由；
      3. 最重要的三条修改建议。
constraints:
  maxSteps: 3
  maxTokens: 60000
  timeLimitMinutes: 15
  stepTimeoutMinutes: 4
  tools:
    deny:
      - computer
      - devices
      - host
      - apps
      - memory
      - schedule
      - handoff
  output:
    format: markdown
    instructions: 先给表格，再给结论。
---

# 代码审查

**安全审查**和**质量审查**同时进行（并行组 `review`），**主审**拿到两份意见后汇总。

这个工作流禁止所有工具：审查只看你粘贴的代码，不会联网、不会碰你的设备或文件。
