---
format: chisabot.workflow/v1
slug: web-to-panel
name: 网页→面板
description: 读取一个网页，提取你关心的数据，确认后做成面板保存到机器人的右栏。
icon: 🧩
version: "1.0"
tags:
  - 面板
  - 网页
bots:
  - key: reader
    name: 网页阅读员
    description: 打开网页，准确提取需要的数据。
  - key: designer
    name: 面板设计师
    description: 把数据做成清爽的右栏面板。
inputs:
  - key: url
    label: 网址
    type: url
    required: true
    placeholder: https://
  - key: want
    label: 想在面板上看到什么
    type: text
    required: true
    placeholder: 例如：最新 5 条公告的标题和日期
steps:
  - id: read
    name: 读取网页
    bot: reader
    tools:
      allow:
        - computer
    prompt: |-
      用云端浏览器打开 {{inputs.url}}，提取和「{{inputs.want}}」相关的数据。
      输出：页面标题、读取时间、提取到的数据（用 Markdown 列表或表格，保留原文数字和日期）、页面上看不到或拿不准的地方。
      打不开网页就如实说明原因，不要编数据。
  - id: design
    name: 做成面板
    bot: designer
    approval: true
    approvalNote: 确认上一步提取的数据没问题后，面板设计师会把它做成面板，保存到这个机器人的右栏面板。
    panel: true
    tools:
      allow:
        - ui
    prompt: |-
      把网页阅读员提取的数据做成一个右栏面板并保存（用面板工具 proposePanelDraft）。面板标题简短，写明数据来源 {{inputs.url}} 和读取时间；数据直接写进面板的初始状态。
      保存成功后用一两句话说明面板展示了什么；保存失败就说明原因，并把数据整理成 Markdown 表格作为输出。
constraints:
  maxSteps: 2
  maxTokens: 80000
  timeLimitMinutes: 20
  tools:
    deny:
      - devices
      - host
      - memory
      - schedule
      - handoff
  output:
    format: markdown
---

# 网页→面板

第二步开始前需要你**批准**：先看一眼提取的数据，没问题再让设计师做面板。面板会出现在负责「面板设计师」角色的那个机器人的右栏里，可以随时撤销或删除。
