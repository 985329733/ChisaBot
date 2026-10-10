# ChisaBot 设计规范

后续所有界面设计和改动都必须遵守本文档。新增或修改组件前先读一遍；与本文档冲突的旧实现，在顺手改到时一并修正。

## 0. 总原则

- **丝滑、流畅、有反馈**：用户的每个操作都要立刻有可见反馈，状态切换要有过渡动画，不允许"点了没反应"或画面突然跳变。
- **反馈就近**：反馈优先出现在用户刚操作的位置（按钮本身、当前卡片），而不是远处的提示或整页遮罩。
- **视觉语言**：蓝天渐变 + 磨砂玻璃（backdrop-filter blur）、圆角、柔和阴影；亮色/暗色模式都必须适配。
- **界面文字一律简体中文。**

## 1. 加载与异步操作的反馈层级

按影响范围从小到大选择，**能用小的就不用大的**：

| 层级 | 适用场景 | 表现 |
| --- | --- | --- |
| ① 按钮内状态（默认首选） | 保存、提交、创建、删除、发送、刷新、复制等单个操作 | 按钮自身变为进行中 → 成功 / 失败，见第 2 节 |
| ② 局部骨架 / 局部加载 | 列表、卡片、面板、弹窗内部内容在加载 | 与最终布局同形状的骨架屏，原地淡入替换，不产生布局跳动 |
| ③ 整页加载弹窗 | 较大的操作：会阻塞整个页面、耗时明显（约 > 2 秒）或涉及多步骤，例如导入/迁移、重建、批量删除、切换部署、首次初始化 | 全页玻璃遮罩 + 居中加载弹窗：转圈 + 标题（"正在导入…"）+ 可选进度/步骤说明；完成后弹窗内显示 ✓ 成功再淡出，失败显示 ✕ 和原因及"重试/关闭" |

- 整页加载弹窗期间禁止重复触发；如可取消，提供"取消"按钮。
- 路由切换、页面首次加载用骨架屏，不允许出现白屏或整页的旧式 loading。

## 2. 按钮状态规范（核心）

所有触发异步操作的按钮都必须实现以下状态机：

```
空闲 ──点击──▶ 进行中 ──成功──▶ 成功 ──约 1.5 秒──▶ 空闲
                    └──失败──▶ 失败 ──约 2 秒──▶ 空闲（并给出错误说明）
```

| 状态 | 文字 | 图标 | 交互 |
| --- | --- | --- | --- |
| 空闲 | 保存 | （原图标） | 可点击 |
| 进行中 | 保存中… | 旋转的圈 | 禁用，防重复提交；aria-busy |
| 成功 | 已保存 / 保存成功 | 圈平滑变形为 ✓ 对号（描边绘制动画） | 短暂停留后自动恢复空闲 |
| 失败 | 保存失败 | ✕ | 恢复可点击，可直接重试；错误原因用就近提示或 toast 说明 |

要求：
- **按钮宽度在各状态间保持不变**（固定最小宽度或按最长文案预留），文字/图标切换用淡入淡出或交叉过渡，不能让周围布局跳动。
- 成功态颜色转为成功色（绿色系），失败态转为危险色（红色系），过渡 150–250ms。
- 文案对应关系：保存→保存中…→已保存；创建→创建中…→已创建；删除→删除中…→已删除；发送→发送中…；复制→已复制。
- 操作极快（< 300ms）时也要至少展示约 300ms 的进行中状态再切成功，避免闪烁。
- 统一使用 `Button` 组件的状态能力，不在页面里各自手写一套。

## 3. 动效

- 时长：微交互 150–250ms；弹窗/面板进出 200–300ms；缓动用 ease-out（进入）/ ease-in（退出）。
- 弹窗：玻璃背景 + 背景模糊遮罩，缩放 + 淡入进入，淡出退出；支持 Esc、点击遮罩关闭（进行中的操作除外）、焦点锁定。
- 尊重系统"减少动态效果"（prefers-reduced-motion）：关闭位移/缩放，只保留淡入淡出。
- 列表增删项有淡入/收起过渡，不要瞬间出现或消失。

## 4. 错误与空状态

- 错误就近展示，用中文说明原因和下一步（"重试"按钮），原始报错放在"查看详情"里。
- 空状态用玻璃虚线卡片 + 一句友好的说明 + 主要操作按钮。
- 危险操作（删除等）必须二次确认，用玻璃确认弹窗，红色强调，写清会删除什么。

## 5. 一致性

- 输入框、选择器、按钮在同一行时高度一致；圆角、填充、焦点光晕统一。
- 新组件优先复用 `components/ui/` 里的已有组件（Button、confirm、toast、skeleton、dialog）。

## 6. 组件用法（实现对照）

以下是第 1–3 节在代码里的唯一实现，页面中不要另写一套：

- **`Button`（`components/ui/button.tsx`）** — 异步按钮状态机。
  - 跟随 TanStack mutation：`<Button mutation={save} feedback="save">保存</Button>`。多行共用一个 mutation 时加 `mutationWhen={save.variables?.id === row.id}`，只让被点的那一行变化。
  - 包装任意异步函数：`const action = useAsyncAction(fn)`，然后 `<Button state={action.state} feedback="save" onClick={() => void action.run()}>`。
  - `feedback` 取预设（`save` / `create` / `delete` / `send` / `copy` / `add` / `submit` / `refresh` / `test` / `stop` / `cancel` / `resume` / `reset` / `generate` / `revoke` / `signin` / `generic`），或传 `{ pending, success, error }` 自定义文案。按钮宽度按最长文案自动预留。
  - 进行中自动禁用并带 `aria-busy`；无需再手写 `disabled={x.isPending}` 或 `x.isPending ? "正在…" : …` 文案。
  - 纯图标按钮（`size="icon*"`）只切换图标（圈 → ✓ / ✕），不显示文字。
- **`useAsyncAction` / `useMutationFeedback`（`components/ui/async-action.ts`）** — 状态机的计时规则（最少 300ms 进行中、成功停留 1.5 秒、失败停留 2 秒）只在这里定义。
- **`AsyncContent`（`components/ui/button.tsx`）** — 少数不能换成 `Button` 的玻璃胶囊按钮使用：在元素上加 `data-btn-state={state}` 和 `async-raw` 类，内部放 `<AsyncContent state labels>`。
- **`CopyButton`（`components/ui/copy-button.tsx`）** — 复制 → ✓ 已复制。
- **`RefreshButton`（`components/ui/refresh-button.tsx`）** — 刷新 → 刷新中… → ✓ 已刷新；`refetch` 请传 `{ throwOnError: true }`，失败才会显示 ✕。
- **`runWithPageLoader(options, fn)`（`components/ui/page-loader.tsx`）** — 第 1 节层级 ③ 的整页加载弹窗。`options` 可含 `title`、`description`、`steps`、`successText`、`errorTitle`；`fn` 收到 `{ step, progress, describe }` 用于更新步骤/进度。成功后显示 ✓ 再淡出并 resolve；失败显示 ✕、原因和"重试 / 关闭"，关闭时 reject。若当前在对话框里触发，先关闭对话框再调用。
- 按钮已显示"已保存"时，不再额外弹"已保存" toast；toast 只用于错误，或结果不在当前视野内的情况（例如该行已从列表中移除）。
- 列表新出现的项加 `list-enter` 类以淡入。

## 7. 背景随时间变化（时间天空）

背景天空跟随用户本机时间（浏览器时间）连续变化，参考 Hark。实现只有一处：`app/src/lib/sky.ts` 的 `computeSky(分钟, 暗色)`，不要在别处另写调色板。

**关键帧**（相邻关键帧之间按分钟做 smoothstep 连续插值，不允许硬切换）：

| 时段 | 时间 | 亮色模式（上 → 下） | 暗色模式 |
| --- | --- | --- | --- |
| 夜晚 | 21:00 – 04:30 | 月光长春花蓝 `#5a6aa0 → #c9cee4`，星星 0.6 | 深海军蓝 `#070d1c → #1a2a4a`，星星 0.85 |
| 拂晓 | 05:30 | 薰衣草 `#7d7fb4 → #efdcdc` | `#11132a → #44324f` |
| 黎明 | 06:30 | 桃色 / 薰衣草 `#9aa6d6 → #fde3cf` | `#1a2140 → #5a3f4f` |
| 上午 | 08:30 | 清新浅蓝 `#84aee0 → #edf4fa` | `#0f1c33 → #264064` |
| 正午 | 11:30 – 14:30 | 经典蓝天（即固定蓝天）`#6f9bc7 → #e4ecf3` | `#0c1626 → #1b304d` |
| 午后 | 16:30 | 暖金 `#7ea3c9 → #f6e6c8` | `#10192c → #3e3730` |
| 傍晚 | 17:45 | 琥珀 `#8a98c0 → #f9dcb4` | `#141a2e → #52382c` |
| 黄昏 | 18:45 | 日落粉紫 `#7a74ad → #f9cfb0` | `#15142c → #5a3343` |
| 入夜 | 19:45 | 暮色蓝紫 `#5f639e → #e2cad6`，星星 0.3 | `#0d1024 → #2f2c4c` |

- 太阳光晕 05:30–19:30、月亮光晕 19:30–05:30 沿弧线从左到右移动，靠近地平线时淡出（交接时看不到跳变）。星星是 6 个静态单点平铺层，只改透明度，向地平线渐隐。不用 canvas、不做逐帧动画。
- **亮色模式的夜晚不是纯黑**：为了让直接放在天空上的深色文字（页面标题、"探索代理"等）保持可读，亮色夜空用偏亮的月光蓝；想要深海军蓝请用暗色模式（同一套时间调色板的暗色版本）。
- **可读性旋钮**：天空变暗时 `--sky-lift`（0–0.14）加厚亮色玻璃（`--glass*`、`--card`、`--sidebar`、`--secondary` 的白色不透明度），`--sky-muted` 加深亮色次要文字（`--muted-foreground`、`--glass-ink-3`）。新增亮色玻璃变量时请同样写成 `rgba(255, 255, 255, calc(基础值 + var(--sky-lift, 0)))`。
- **性能约定**：会过渡的 `--sky-1..4`、`--sky-cloud`、`--sky-glow(-x/-y)` 用 `@property` 注册为**不继承**，只写在 `<body>` 上（每分钟一次 1.6s 过渡只重绘背景）；`--sky-stars`、`--sky-lift`、`--sky-muted` 是普通继承变量，每分钟最多变一次、自身不做动画。不要把天空渐变放回 `:root` 的变量里（`var()` 会在 `:root` 上求值，读不到 body 上的值）。
- **首屏**：Vite 插件 `chisabot-sky-boot` 把 `computeSky` 序列化后内联到 `index.html` 的 `<body>` 开头，骨架屏首帧就是当前时间的天空，不会先闪蓝天或白屏。因此 `computeSky` 必须完全自包含（不引用函数体外的任何东西）。全屏骨架 `.sky-skel` 背景必须透明，透出 body 的天空。
- **设置**：偏好设置 → 通用 →「背景随时间变化」开关（默认开，`localStorage` 键 `chisabot-sky`，`off` 为关闭，关闭后平滑回到固定蓝天）；开启时下方展开「预览时间」滑块（15 分钟一档），仅临时预览，离开设置页恢复当前时间，不保存。
- **减少动态效果**（prefers-reduced-motion）：颜色照常淡变，光晕位置不做移动过渡。

## 8. 左右栏收起 / 展开

主界面（`_authed/_app`）左侧机器人列表和右侧自定义面板栏都可以收起，按钮常驻顶栏，收起后也永远能找回。

- **按钮**：40px 圆形玻璃图标按钮（`.glass-icon-btn`），带 `aria-expanded`、`aria-controls`、提示文字含快捷键。
  - 左栏：顶栏首页按钮右侧，提示「收起机器人列表 / 展开机器人列表」，快捷键 Ctrl+B（Mac ⌘B，沿用侧边栏原有快捷键）。
  - 右栏：顶栏搜索框左侧，提示「收起面板 / 展开面板」，快捷键 Ctrl+Alt+B（Mac ⌘⌥B）；只在右栏存在的宽度（≥1280px）显示。Ctrl+B 不会响应带 Alt/Shift 的组合。
  - 图标说的是点击后会发生什么（收起 ↔ 展开图标切换时淡入 + 轻微旋转）。
- **左栏收起 = 头像栏**：宽度 276px → 80px，内容是「＋ 新聊天」、机器人头像列表（主机器人排第一并带星标，当前机器人蓝色描边 + 左侧蓝条，未读/待处理显示蓝点或数字）、底部 机器人/代理/团队 Bot/记忆 图标；每项悬停有右侧提示。实现用 shadcn 侧边栏的 `collapsible="icon"`，宽度由 `SidebarShell iconWidth` 控制，不要另写一套状态。
- **右栏收起**：宽度 → 0、左右内边距 → 0、淡出，内部列宽保持不变向右滑出（不重排）；收起时 `inert` + `aria-hidden`，拖动调整宽度的把手隐藏；展开后拖动把手照常工作，宽度仍记在 `chisabot-panel-rail-width`。
- **动效**：宽度过渡 260ms，`cubic-bezier(0.22, 0.8, 0.24, 1)`（变量 `--glass-collapse-ms` / `--glass-collapse-ease`）；完整列表展开时按最终宽度排版、被裁切地"推出"，不允许文字在过渡中挤压换行。中间聊天区随之平滑变宽，内容最大宽度不变、居中。减少动态效果时宽度直接切换，只保留淡入淡出。
- **记忆**：按设备存在 `localStorage`：左栏 `openbot-sidebar`（`expanded` / `collapsed`），右栏 `chisabot-panel-rail`（同上）。只有精确的 `collapsed` 才算收起。
- **窄屏**：<1280px 右栏本来就不显示（按钮也隐藏）；<768px 左栏仍是原来的抽屉（Sheet），顶栏不显示左栏收起按钮，页面内原有的侧边栏按钮照旧。桌面端页面头部不再重复显示侧边栏按钮（`TopBarOwnsSidebarToggle`）。
- 天空背景透过收起后的空白区域正常显示，不加任何遮罩。

---

# 天空玻璃 Skyglass 设计系统（§9–§14）

> 原型：`chisabot-proto/index.html`。§0–§8 的规则全部保留。

## 9. 统一原则（解决"拼接感"）

现状的问题：聊天页有顶栏和机器人列表，设置页与管理后台各自用 300px 的 shadcn 侧栏、没有顶栏；页头、卡片、间距、字号、密度各页不同。统一做法：

1. **一套外壳**：所有登录后的页面（聊天、列表、详情、设置、管理）都用同一个 App Shell —— 顶栏 + 左栏 + 中间 + 可选右栏。设置和管理不再是"另一个应用"。
2. **左栏同一组件族**：聊天页左栏是"主机器人 + AI 同事"（只有机器人列表，不列会话；会话用顶栏「搜索会话」查找），设置页是"偏好设置分区"，管理页是"按问题分组的管理导航"——三者都是 `RailFull`（顶部胶囊按钮 + 玻璃卡片 + 分组标签 + `NavRow` 行 + 底部区）和 `RailSlim`（80px 头像/图标栏），共用收起逻辑（Ctrl+B）。
3. **墨色 = 主操作 / 选中；天蓝 = 强调 / 焦点 / 开关**。顶栏选中的导航胶囊、主按钮、发送键、首页按钮都是墨色；天蓝只用于焦点光晕、开关开启、进度条、左栏选中竖条、链接。
4. **玻璃三层**：L1 放在天空上的栏与卡片；L2 卡内控件、输入框、选中态；L3 浮层（弹窗、菜单、toast、未保存栏）。层级越高越不透明。
5. **一种页头**：面包屑/眉题（12px）→ 标题（24px/600）→ 说明（14px，最多约 620px 宽）→ 右侧操作区。所有页面都一样。
6. **一种区块**：区块标题（16px/600 + 13px 说明）放在天空上，内容放在 L1 玻璃卡片里；卡片内用列表行 `lrow` 或设置行 `srow`，行间用 1px 分隔线。

---

## 10. 令牌（CSS 自定义属性）

### 10.1 颜色

| 令牌 | 亮色 | 暗色 | 用途 |
| --- | --- | --- | --- |
| `--glass-1` | `rgba(255,255,255, .46 + lift)` | `rgba(16,25,44,.52)` | 栏、卡片（直接放在天空上） |
| `--glass-2` | `rgba(255,255,255, .66 + lift)` | `rgba(30,42,66,.62)` | 输入框、卡内控件、选中行 |
| `--glass-3` | `rgba(255,255,255, .86 + lift)` | `rgba(22,32,54,.9)` | 弹窗、菜单、toast、未保存栏 |
| `--stroke` | `rgba(255,255,255,.72)` | `rgba(255,255,255,.09)` | 玻璃高光描边 |
| `--line` / `--line-strong` | `rgba(22,36,62,.08/.14)` | `rgba(255,255,255,.07/.13)` | 卡内分隔线 / 输入框边框 |
| `--ink-1` | `#111a2b` | `#e9eef8` | 标题、正文 |
| `--ink-2` | `#3b4659` | `#b7c1d3` | 次要正文、页头说明 |
| `--ink-3` | `var(--sky-muted)` | `#8b97ab` | 说明、元信息（随天空加深） |
| `--ink-4` | `rgba(17,26,43,.36)` | `rgba(233,238,248,.32)` | 占位符 |
| `--primary` / `--on-primary` | `#15203a` / `#fff` | `#e9eff9` / `#0e1628` | 墨色主操作、选中导航 |
| `--accent` / `--accent-soft` | `#2f74f0` / 12% | `#5b95ff` / 16% | 强调、焦点、开关 |
| `--success` `--warn` `--danger`（+ `-soft`） | `#17955c` `#c97a0c` `#d93d40` | `#3ccf8a` `#f0b04a` `#ff6b6e` | 语义色；按钮成功/失败态 |

- 亮色玻璃的白色不透明度一律写成 `calc(基础值 + var(--sky-lift, 0))`（DESIGN.md §7 的可读性旋钮）。
- 天空 `--sky-1..4 / --sky-cloud / --sky-glow` 继续只来自 `app/src/lib/sky.ts` 的 `computeSky`，原型内嵌的是同一份调色板。

### 10.2 字体

`--font: "PingFang SC", "HarmonyOS Sans SC", "MiSans", "Noto Sans SC", "Noto Sans CJK SC", "Source Han Sans SC", "Microsoft YaHei UI", system-ui, sans-serif`
`--font-mono: "JetBrains Mono", "SF Mono", "Cascadia Code", ui-monospace, Menlo, Consolas, monospace`

| 令牌 | 字号 / 字重 | 用途 |
| --- | --- | --- |
| `--fs-32` | 32 / 600 | 首页"开始新会话"、统计数字、引导大标题 |
| `--fs-24` | 24 / 600 | 页面标题 |
| `--fs-20` | 20 / 600 | 弹窗标题（原型中 18） |
| `--fs-16` | 16 / 600 | 区块标题、卡片标题、聊天头 |
| `--fs-14` | 14 / 400–500 | 正文、按钮、输入框、列表行标题（500） |
| `--fs-13` | 13 / 400 | 说明文字、列表行副标题、表格次要列 |
| `--fs-12` | 12 / 500 | 眉题、徽标、元信息、左栏分组标签 |

行高：正文 1.6，标题 1.3。不使用 15/17/18 等中间字号（例外：大号按钮 15、聊天输入 15）。

### 10.3 间距、圆角、阴影、模糊

- **间距（4pt）**：`--sp-1..16` = 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 / 64。
  - 卡片内边距 20（`card-h`/`card-b`），卡片之间 16，区块之间 32，页头下方 24，工具条下方 16。
  - 外壳：顶栏 72（移动端 60），左栏 276 / 收起 80，右栏 340，三栏间距 16，外边距 16。
  - 内容最大宽度：列表/设置 880，管理与设计规范 1080（`.page.wide`），聊天 780–820，窄页 720。
- **圆角**：`--r-xs 6`（kbd）· `--r-sm 10`（小控件、菜单项）· `--r-md 14`（输入框、popover、代码块）· `--r-lg 20`（卡片）· `--r-xl 24`（左栏卡片、弹窗、聊天输入框）· `--r-pill`（所有按钮、胶囊、徽标、分段控件）。
- **阴影**：`--shadow-1`（卡片、按钮）· `--shadow-2`（悬停卡片、输入框、菜单）· `--shadow-3`（弹窗）；玻璃表面加 `--inset-hl` 顶部高光。
- **模糊**：`--blur-1 12px`（小控件）· `--blur-2 22px`（栏、卡片）· `--blur-3 36px`（浮层）。只写不带前缀的 `backdrop-filter`（见 chisabot-design 技能里的压缩器坑）。

### 10.4 动效

| 令牌 | 值 | 用途 |
| --- | --- | --- |
| `--dur-1` | 150ms | 悬停、按下、颜色 |
| `--dur-2` | 220ms | 状态切换、淡入淡出、开关 |
| `--dur-3` | 300ms | 弹窗/页面进入、导航胶囊滑动、未保存栏 |
| `--dur-collapse` | 260ms | 左右栏收起（= DESIGN.md §8 的 `--glass-collapse-ms`） |
| `--ease-out` | `cubic-bezier(.22,.8,.24,1)` | 进入 |
| `--ease-in` | `cubic-bezier(.4,0,1,1)` | 退出 |

页面切换：中间区先出同形状骨架（约 300ms 内），再以 6px 上移 + 淡入出现内容（`page-in`）。顶栏导航胶囊在路由间滑动。减少动态效果时只保留淡入淡出。

---

## 11. 组件

| 组件 | 规格要点 | 原型类名 |
| --- | --- | --- |
| 按钮 | 胶囊；高 40（sm 32 / lg 48）；primary 墨色 · secondary 玻璃 L2 · ghost 透明 · danger 红 · danger-soft 浅红 · accent 天蓝（仅特殊强调） | `.btn .btn-*` |
| 异步按钮 | DESIGN.md §2 状态机：空闲 → 进行中（转圈，禁用，aria-busy）→ 成功（✓ 描边绘制，绿，1.5s）/ 失败（✕，红，2s，toast 说明原因）。四种文案叠放在同一网格里，宽度取最长者，**状态间宽度不变** | `[data-async][data-state]` |
| 图标按钮 | 32 方形圆角 10（行内）；顶栏 40 圆形玻璃（`.glass-icon-btn`）；纯图标异步按钮只换图标 | `.icon-btn` `.btn.icon-only` |
| 输入框 / 选择器 / 多行 | 高 40（sm 32），圆角 14，L2 背景，`--line-strong` 边框；焦点：天蓝边框 + 3px 光晕 + L3 背景；错误：红框 + 红色说明 | `.input .select .textarea` |
| 开关 | 40×24，开启为天蓝 | `.switch[aria-checked]` |
| 滑块 | 6px 轨道，天蓝填充；时间预览滑块用天空渐变轨道 | `.slider` `.slider.sky` |
| 分段控件 | 卡内筛选、主题选择；选中项为 L3 白片 + 阴影 | `.segmented` |
| 顶栏主导航 | 玻璃胶囊 + 墨色滑块（选中）；聊天 / 长期任务 / 技能 | `.seg-nav` |
| 标签页 | 详情页分区；选中为 2px 天蓝下划线 | `.tabs` |
| 徽标 / 胶囊 | 22 高；中性 / ok / warn / danger / accent / outline，可带圆点；放在天空上时自动加玻璃底 | `.badge` `.chip` |
| 头像 | 24 / 32 / 44 / 72；机器人用渐变；主机器人右下角金色星标（会话行内不显示星标） | `.av` `.star` |
| 左栏行 | 40–52 高，圆角 14；选中：L3 背景 + 阴影 + 左侧 3px 天蓝竖条。机器人、会话、设置分区、管理导航都用它 | `.nav-row` |
| 列表行 | 卡内 64 高，40px 图标/头像 + 标题（14/500）+ 副标题（13）+ 右侧徽标/操作 | `.lrow` |
| 设置行 | 左：标题 + 说明；右：控件；移动端控件自动换行 | `.srow` `.sblock` |
| 卡片 | L1 玻璃，圆角 20，`card-h` / `card-b` / `card-f`（右对齐操作区）；可悬停上浮；虚线卡片用于空状态 | `.card` |
| 页头 / 区块头 | 见 §9.5 / §9.6 | `.ph` `.sh` |
| 工具条 | 分段筛选（左）+ 搜索（右） | `.toolbar` |
| 表格（管理） | 表头 12px `--ink-3`；行 52 高；首尾列 20px 内边距；末列右对齐放操作 | `.tbl` |
| 统计磁贴 | 13px 标签 + 32px 数值 + 12px 对比 | `.stat` |
| 代码块 | 深色固定底（亮暗都是深色），顶部语言 + 复制按钮 | `.code` |
| 空状态 | 虚线玻璃卡 + 52px 图标块 + 标题 + 一句说明 + 主操作 | `.empty` |
| 错误卡 | 浅红玻璃 + 原因 + 下一步（重试）+"查看详情"折叠原始报错 | `.errcard` |
| 骨架 | 与最终布局同形状的流光块；路由切换先显示 | `.skel` |
| Toast | 底部居中，L3；成功/错误/信息图标；错误带"重试" | `.toast` |
| 确认弹窗 | L3，圆角 24，红色图标块，写清会删除什么；确定按钮是异步删除按钮 | `.dialog` |
| 表单弹窗 | 同上，内容是 `field` 纵向排列；确定按钮是异步创建按钮 | `formDialog` |
| 整页加载 | DESIGN.md §1 层级 ③：转圈 → 步骤列表 + 进度条 → ✓ 成功淡出 / ✕ 失败显示原因 +"关闭 / 重试" | `.loader-card` |
| 菜单 / 弹出层 | L3，圆角 14，菜单项 36 高，危险项红色 | `.popover .menu-item` |
| 未保存栏 | 中间区底部悬浮胶囊：橙色脉冲点 +"有未保存的更改"+ 放弃 + 保存（异步）；保存成功后收起 | `.savebar` |
| 聊天气泡 | 我：墨色气泡右对齐（20/20/6/20 圆角）；机器人：头像 + 名字/时间 + L1 玻璃气泡；工具调用为可展开胶囊 | `.bubble` `.bot-text` `.tool-call` |
| 输入框（聊天） | L3，圆角 24，焦点天蓝光晕；底部：模型胶囊 + 附件 + 技能 + 墨色发送键 | `.composer` |
| 模型胶囊 | 头像 + BOT 名 + 分隔 + 模型名 + ▾，点击弹出"机器人 / 模型"两段菜单 | `.model-pill` |
| 面板卡 | 右栏：图标 + 标题 + 操作；内容区 L2 子卡；底部版本元信息 | `.panel-card` |

---

## 12. 页面模板

| 模板 | 结构 | 内容宽 |
| --- | --- | --- |
| **A 聊天工作区** | 左栏（主机器人置顶 + AI 同事，**不含会话列表**）· 中间（聊天头 + 消息 + 底部输入框）· 右栏（自定义面板 / 计算机） | 780–820 |
| **B 列表 / 管理** | 页头（标题 + 说明 + 主操作）→ 工具条（分段 + 搜索）→ 卡片列表或卡片网格 → 次级区块 | 880 |
| **C 详情 / 编辑** | 面包屑 → 大头像页头（72px + 标题 + 说明 + 徽标 + 操作）→ 标签 → 分区卡片表单 → 危险区；改动后出现未保存栏 | 880 / 1080 |
| **D 设置** | 与 C 同样的分区卡片；左栏换成设置分区导航；`srow` 行 + 未保存栏 | 880 |
| **E 管理后台** | 加宽；统计磁贴 + 表格卡片；左栏换成按问题分组的管理导航（机器人可以访问什么 / 可以做什么 / 谁可以进入 / 发生了什么） | 1080 |
| **F 认证** | 无外壳；天空上居中的玻璃卡（420–440），右上角主题切换 | 420 |
| **G 引导 / 空状态** | 无外壳；步骤点 + 大标题 + 卡片；列表的空状态用虚线卡 | 860 |

## 13. 页面 → 模板对照（覆盖 `app/src/routes` 全部路由）

| 路由文件 | 页面 | 模板 | 左栏 | 右栏 | 原型地址 |
| --- | --- | --- | --- | --- | --- |
| `_app/index.tsx` | 开始新会话（首页） | A | 应用 | 面板 | `#/` |
| `_app/channel/$channelId.tsx` | 会话 | A | 应用 | 面板 | `#/c/c1` |
| `_app/bot.tsx`（ComputerViewPanel） | 会话 + 机器人计算机 | A | 应用 | 计算机 | `#/c/c3`、`#/bot/local` |
| `_app/group/$channelId.tsx` | 群组会话 | A | 应用 | 面板 | `#/group/g1` |
| `_app/channel/new.tsx` | 新聊天（选择同事） | A | 应用 | 面板 | `#/channel/new` |
| `_app/group/new.tsx` | 新群组会话 | A/B | 应用 | 面板 | `#/group/new` |
| `_app/responsibilities.tsx` | 长期任务（含 GitHub 事件源、新建弹窗） | B | 应用 | 面板 | `#/responsibilities` |
| `_app/routines.tsx` | 定时任务 | B | 应用 | 面板 | `#/routines` |
| `_app/skills.tsx` | 技能 | B | 应用 | 面板 | `#/skills` |
| `_app/agents/index.tsx` | 代理 | B | 应用 | 面板 | `#/agents` |
| `_app/bots.index.tsx` | 机器人列表 | B | 应用 | 面板 | `#/bots` |
| `_app/bots.$agentId.tsx` | 机器人设置 | C | 应用 | 面板 | `#/bots/general` |
| `_app/team-bots.tsx` | 团队 Bot | B | 应用 | 面板 | `#/team-bots` |
| `_app/memory.tsx` | 记忆 | B | 应用 | 面板 | `#/memory` |
| `_app/approvals.tsx` | 审批 | B | 应用 | 面板 | `#/approvals` |
| `_app/reachability.tsx` | 可达性 | B | 应用 | 面板 | `#/reachability` |
| `components/panels/panel-rail.tsx`（面板库 Sheet） | 面板库 | B | 应用 | 面板 | `#/panels` |
| `settings/index.tsx` | 偏好设置 · 通用（外观 / 背景随时间变化 / 消息列表 / 常驻指令 / 快捷键） | D | 设置 | — | `#/settings` |
| `settings/connected-accounts/index.tsx` | 已连接账号 | D | 设置 | — | `#/settings/accounts` |
| `settings/connected-accounts/$key.tsx` | 账号详情 | C | 设置 | — | `#/settings/accounts/github` |
| `settings/passwords.tsx` | 密码（已保存的登录） | D | 设置 | — | `#/settings/passwords` |
| `settings/components-gallery/index.tsx`（及 `$name`） | 组件库 | B | 设置 | — | `#/settings/gallery` |
| —（新增） | 设计规范 | B | 设置 | — | `#/design` |
| `admin/index.tsx` | 部署概览 | E | 管理 | — | `#/admin` |
| `admin/models.tsx` | 模型设置 | E | 管理 | — | `#/admin/models` |
| `admin/credentials.tsx` | 凭据 | E | 管理 | — | `#/admin/credentials` |
| `admin/boundaries.tsx` | 权限规则 | E | 管理 | — | `#/admin/boundaries` |
| `admin/computers.tsx` | 计算机（演示错误卡 → 重试） | E | 管理 | — | `#/admin/computers` |
| `admin/plugins/index.tsx` | 插件 | E | 管理 | — | `#/admin/plugins` |
| `admin/plugins/$key.tsx`（及 `$key_.tools.$tool`、`$key_.bots.$agentId`） | 插件详情（工具 / 机器人访问） | C | 管理 | — | `#/admin/plugins/github` |
| `admin/plugins/composio.tsx` | 浏览 Composio | E | 管理 | — | `#/admin/plugins/composio` |
| `admin/skills.tsx` | 技能（部署） | E | 管理 | — | `#/admin/skills` |
| `admin/learning.tsx` | 自动学习（整页加载演示） | E | 管理 | — | `#/admin/learning` |
| `admin/components/index.tsx`（及 `$name`） | UI 组件 | E | 管理 | — | `#/admin/components` |
| `admin/playground.tsx` | 游乐场 | E | 管理 | — | `#/admin/playground` |
| `admin/people.tsx` | 人员 | E | 管理 | — | `#/admin/people` |
| `admin/identity-providers.tsx` | 身份提供者 | E | 管理 | — | `#/admin/identity-providers` |
| `admin/enterprise.tsx` | 企业网络（整页加载演示） | E | 管理 | — | `#/admin/enterprise` |
| `admin/audit.tsx` | 审计 | E | 管理 | — | `#/admin/audit` |
| `sign.tsx` | 登录 | F | — | — | `#/sign` |
| `sign-in/$requestId.tsx` | 机器人登录请求 | F | — | — | `#/sign-in/req` |
| `onboarding.tsx` | 新手引导（3 步） | G | — | — | `#/onboarding` |

`__root.tsx`、`_authed.tsx`、`_authed/_app.tsx`、`admin/route.tsx`、`settings/route.tsx` 是布局路由：落地时让 `admin/route.tsx` 与 `settings/route.tsx` 也渲染统一的 `GlassTopbar`，并把 `AdminSidebar` / `SettingsSidebar` 改为复用机器人列表的 `RailFull` / `RailSlim` 组件（同一个 `SidebarShell iconWidth=80`），宽度统一为 276。

## 14. 落地建议（实现顺序）

1. 把 §10 令牌写进 `styles.css` 的 `:root` / `.dark`（与现有 `--glass*`、`--sky-*` 合并，去掉各页自定义的颜色/圆角）。
2. 抽出 `PageHeader`、`Section`、`Card`、`ListRow`、`SettingRow`、`Toolbar` 到 `components/ui/`；`PageShell` 改为使用它们。
3. 设置与管理的布局路由接入顶栏和统一左栏（§13 末段）。
4. 逐页替换：先 B 类列表页（改动最机械），再 D 设置、E 管理，最后 C 详情页加未保存栏。
5. 每步用 openbot-redesign 的截图脚本对照原型截图。

### 14.1 落地记录（2026-10-10，image glass-20261010k）

- 令牌在 `app/src/styles.css` 的 "Skyglass design tokens" 块；旧名 `--glass*`、shadcn 的 `--primary/--border/--ring…` 已改为这些令牌的别名。原型的 `--accent` 在代码里叫 `--accent-blue`（shadcn 已占用 `--accent` 作中性悬停色）；`--font-mono` 的实际值在 `--font-code`。
- 根字号改为 16px，使 Tailwind 的 `text-xs/sm/base/xl/2xl` 正好落在 12/14/16/20/24。
- 外壳：`components/layout/glass-shell.tsx`（`GlassShell scope="app|settings|admin"`），聊天、设置、管理三个布局路由都用它；顶栏 `GlassTopBar scope`：设置/管理里没有右栏按钮、导航胶囊不选中、搜索输入后跳回聊天显示结果。移动端（<768px）顶栏左侧的首页按钮换成 ☰ 抽屉按钮，避免被居中的导航胶囊盖住。
- 左栏：聊天用 `AppSidebar`（**只列机器人**，主机器人置顶）；设置/管理用 `components/layout/section-rail.tsx` 的 `SectionRail`（顶部「返回应用」胶囊 + L1 卡片 + `nav-row` 行 + 底部用户区 + 收起后的 80px 图标栏）。
- 页面：`PageShell` 内置统一页头 `PageHeader`（眉题默认取所在区域「偏好设置 / 管理后台」，`backButton` 变成面包屑），管理页默认 1080 宽，其余 880。`PageSection/PageRows/PageEmpty/PageSkeleton` 的外观全部按 §11 改为 L1 卡片 + 64px 行。
- 组件：`components/ui/skyglass.tsx` 提供 `Card/CardHeader/CardBody/CardFooter/ListRow/SettingRow/Toolbar/StatTile/EmptyState/ErrorCard/SaveBar`。`SaveBar` 用 portal 挂在 `.glass-main` 底部；「常驻指令」已改用它（放弃 / 保存）。
- 未落地（原型中的纯装饰或无后端）：主题「跟随系统」、界面密度、设计规范页、部署概览统计磁贴（无现成数据接口）；面板库仍是 Sheet。

## 15. 模型平台 Magpie（2026-10-10，image glass-20261010l）

- 路由：`admin/magpie/index.tsx`（模板 E，1080）与 `admin/magpie/console.tsx`（内嵌控制台）。管理导航「机器人可以访问什么」组、部署概览、顶栏头像菜单「管理员」组都改为站内链接「模型平台 Magpie」，不再在新标签页打开 `:2053`。
- 状态页结构：页头（主操作「打开 Magpie 管理」+ 次操作「刷新状态」）→ 4 个 `StatTile`（网关状态 / 就绪的提供方 / 可用模型 / 上次同步，`.magpie-stats` 四列，≤900px 两列）→「ChisaBot 接入」卡片（`SettingRow`：模型网关、接口地址、部署默认模型、模型同步、模型设置；区块操作「立即同步模型」）→「提供方」卡片（`ListRow` + `ProviderMark` + 状态徽标）→「Magpie 管理」入口卡片。
- 异步按钮：「刷新状态」用 `RefreshButton`（Magpie 不可访问时落到 ✕）；「立即同步模型」用自定义 feedback `同步中… / 已同步 / 同步失败`。
- 徽标 `.magpie-badge`（`is-ok / is-warn / is-danger`，用 `--success/--warn/--danger` 与对应 `-soft`），代码值 `.magpie-code`（`--font-code`、L2 玻璃底）。浅色、深色都只用令牌。
- 健康点 `.model-health-dot`（7px，`is-ok` 绿 + 3px 柔光、`is-bad` 红、`is-off` 灰）。模型选择器的提供方分组标题：`ProviderMark` + 提供方名称（来自 Magpie 的 `magpie_label`）+ 健康点 + 右侧等宽的提供方 ID；当前模型所在提供方未就绪时，药丸上也显示红点。底部文案「Magpie · 共 N 个模型 · 下一轮生效」，网关不可用时改为「网关暂不可用，显示上次列表」。
- 内嵌控制台：统一页头（面包屑「管理后台 / 模型平台 Magpie」，操作「重新载入」「新窗口打开」）下方是一张 L1 玻璃卡片（`.magpie-frame-wrap`，最大 1280 宽，填满剩余高度），iframe 载入完成前显示居中的骨架条「正在载入 Magpie 控制台…」，载入后淡入（`--dur-2`，尊重 prefers-reduced-motion）。Magpie 自己的界面跟随系统浅色/深色。

## 16. 设备 / PC 节点（2026-10-10，image glass-20261010m）

架构见 `docs/pc-node.md`。网页三处页面，PC 客户端本地窗口沿用同一套令牌。

- **路由**：`settings/devices/index.tsx`（偏好设置 → 设备，模板 B，880）、`settings/devices/$deviceId.tsx`（设备详情，模板 C，面包屑「偏好设置 / 设备」）、`admin/devices.tsx`（管理后台 → 设备（PC），模板 E，1080，在「机器人可以访问什么」组，紧跟「计算机」）。设置左栏新增「设备 · PC 客户端与远程控制」。
- **列表行**（`DeviceRow` = `ListRow` 包一层 `Link`）：40px 设备图标（`.device-icon`，Windows 用 Windows 标志；右下角状态点：在线绿色带柔光 / 离线灰 / 紧急停止红）+ 名称 + 副标题「系统 · 主机名 · 最后在线 · 已开启 N 项能力」+ 右侧状态徽标 + ›。
- **状态徽标**（`.device-badge`，24 高，`is-ok / is-warn / is-danger / is-muted`，`is-sm` 20 高）：在线（绿点脉冲，尊重 prefers-reduced-motion）/ 离线 / 已紧急停止（红，■ 图标）/ 已撤销（灰）。
- **待审批卡片**（`ApprovalsCard`）：L1 卡片 + 橙色描边；每行 = 橙色盾牌图标块 + 「〈机器人〉想在「〈设备〉」上〈操作〉」+ 等宽字体的操作摘要块 + 倒计时「N 秒后自动拒绝」+ 右侧「拒绝」（异步按钮，处理中… → ✓ 已处理）「允许」。≤640px 时按钮换到下一行右对齐。列表页顶部和详情页标签上方都显示。
- **详情页头**（`.device-hero`）：72px 图标（圆角 22，L1 阴影）+ 徽标行（状态 / 系统 / 客户端版本）+ 一行灰色说明（系统版本 · 主机名 · 最后在线 · IP）+ 右侧「测试连接」（`feedback="test"`，离线或停止时禁用）与「紧急停止」（destructive，停止中… → ✓ 已停止）/「解除紧急停止」。≤640px 按钮占满一行等分。紧急停止中时页头下方出现浅红横条说明。
- **标签**（`.device-tabs`，2px 天蓝下划线，可横向滚动）：权限 / 操作记录 / 设备。
- **能力行**：`SettingRow`（图标 + 名称 + 「高风险」橙色小徽标 + 说明）右侧三段分段控件 关闭 / 询问 / 允许（`sg-segmented`；选中「询问」字色橙、「允许」字色绿）。移动端控件换行到整行右对齐（沿用 `.sg-srow` 规则）。
- **允许的文件夹**：每行 = 文件夹图标 + 等宽路径 + 删除图标按钮；底部输入框 + 「添加」，非绝对路径时输入框红框 + 红色说明。
- **可用机器人**：52 高复选行（复选框 + 渐变头像首字 + 名称）。
- **保存**：能力、文件夹、机器人、名称的改动统一走未保存栏（放弃 + 异步保存）；服务器或 PC 端改了配置而本页没有未保存改动时自动跟上最新值。紧急停止、测试连接、撤销、删除是即时操作，用按钮内状态；撤销和删除先弹玻璃确认框（红色，写清后果）。
- **操作记录**（`AuditList`）：时间（等宽数字）· 发起者（机器人名 / 「xx（网页）」/ PC 客户端）+ 操作名 · 等宽摘要 · 灰色细节；右侧结果徽标（成功绿 / 已拒绝、用户拒绝、审批超时橙 / 失败、超时红 / 进行中、离线灰）+ 耗时。≤640px 时时间和结果在第一行，摘要换到第二行。
- **添加一台电脑**：下载卡片（Windows 图标 + 版本 · 大小 + 主操作「下载安装包」；免安装 zip 一行；SHA-256 一行）+ 三步说明卡（天蓝圆形序号；第二步带服务器地址等宽胶囊和复制按钮）。安装包未发布时卡片写明「还没有发布到这台服务器」。
- **PC 客户端本地窗口**（`chisabot-pc/src/ui`）：同一套令牌的子集（`ui.css`），天空渐变按本机时间分黎明 / 白天 / 傍晚，浅色 / 深色跟随系统；异步按钮同 §2 状态机（`ui.js` 的 `asyncButton`：≥300ms 进行中、成功 1.5s、失败 2s、宽度不变）。审批弹窗：右下角 440×300 置顶，橙色盾牌 + 「〈机器人〉想〈操作〉」+ 等宽摘要 + 倒计时 + 「拒绝」「允许这一次」，Esc 等于拒绝。
