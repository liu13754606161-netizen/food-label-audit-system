# UI 设计指南

> **设计类型**: App 设计（应用架构设计）
> **确认检查**: 本指南适用于可交互的应用/网站/工具。

> ℹ️ Section 1-2 为设计意图与决策上下文。Code agent 实现时以 Section 3 及之后的具体参数为准。

## 1. Design Archetype (设计原型)

### 1.1 内容理解

- **目标用户**: 食品行业合规审核人员、标签设计人员，需要专业、可靠的工具完成合规性检查，使用场景为办公室桌面端
- **核心目的**: 提供食品标签OCR识别、合规审核和标签生成功能，帮助用户快速完成合规检查和标签制作
- **期望情绪**: 专业可信、高效清晰、沉稳可靠
- **需避免的感受**: 随意、花哨、信息混乱、不可靠

### 1.2 设计语言

- **Aesthetic Direction**: 专业合规工具需要清晰的信息层级、沉稳的配色方案、易于阅读的排版，让用户专注于数据审核和编辑
- **Visual Signature**: 
  1. 深蓝主色调传递专业信任感
  2. 清晰的卡片分组，信息分区明确
  3. 柔和圆角，兼顾专业度和亲和力
  4. 充足留白，避免信息过载
- **Emotional Tone**: 专业可靠 — 食品合规关乎食品安全，设计需要传递权威感和可信度
- **Design Style**: Soft Blocks 柔色块 — 专业工具需要清晰分组，柔和圆角和低饱和度色块让界面不刺眼，长时间审核不易疲劳
- **Application Type**: Tool/SaaS - 多页面业务工具，需要侧边栏导航

## 2. Design Principles (设计理念)

1. **专业性优先**：食品合规审核是严肃工作，设计语言必须体现专业权威，避免花哨装饰

2. **信息分层清晰**：OCR识别结果、审核标准、不通过项需要清晰分组，一目了然

3. **操作路径明确**：从上传 → 识别 → 编辑 → 审核 → 导出流程连贯，每一步都有清晰指引

4. **状态反馈及时**：上传进度、识别结果、审核状态都需要明确的视觉反馈

5. **舒适的工作体验**：长时间使用不疲劳，色彩柔和，排版宽松，对比度合适

## 3. Color System (色彩系统)

> 基于内容理解推导配色方案，确保整体协调。

**配色设计理由**：食品合规审核需要建立用户信任感，选择沉稳专业的深蓝色作为主色，低饱和度配色降低视觉疲劳，清晰的状态色帮助快速识别审核结果。

### 3.1 主题颜色

> **Color Token 语义速查（供 code agent 参考）**:
> - `primary` → 主行动：按钮填充、激活态高亮、关键操作 CTA
> - `accent` → 状态反馈：Ghost/Outline 按钮 hover、DropdownMenu focus、Toggle 激活、Skeleton 占位背景
> - `muted` → 静态非交互：禁用态背景、次级说明背景、占位文字色（`text-muted-foreground`）
> - **选择原则**：用户"可以点击" → primary；交互"正在发生" → accent；内容"不可操作" → muted

| 角色               | CSS 变量               | Tailwind Class            | HSL 值    
| ------------------ | ---------------------- | ------------------------- | ---------- 
| bg                 | `--background`         | `bg-background`           | `hsl(215 25% 97%)`
| card               | `--card`               | `bg-card`                 | `hsl(0 0% 100%)`
| text               | `--foreground`         | `text-foreground`         | `hsl(215 40% 12%)`                   
| textMuted          | `--muted-foreground`   | `text-muted-foreground`   | `hsl(215 16% 42%)`                      
| primary            | `--primary`            | `bg-primary`              | `hsl(212 80% 45%)` 
| primary-foreground | `--primary-foreground` | `text-primary-foreground` | `hsl(0 0% 100%)`
| accent             | `--accent`             | `bg-accent`               | `hsl(212 80% 96%)` 
| accent-foreground  | `--accent-foreground`  | `text-accent-foreground`  | `hsl(212 80% 45%)`
| border             | `--border`             | `border-border`           | `hsl(215 20% 88%)`

### 3.2 Sidebar 颜色（仅当使用 Sidebar 导航时定义）

> **定义时机**：仅当 Navigation Type 为 Sidebar 时，必须定义此章节
> **设计原则**：Sidebar 作为全局导航区域，需要独立的配色方案以区分主内容区，所有 sidebar 颜色角色需保持统一的视觉基调。

| 角色                       | CSS 变量                       | Tailwind Class                    | HSL 值     | 设计说明                         |
| -------------------------- | ------------------------------ | --------------------------------- | ---------- | -------------------------------- |
| sidebar                    | `--sidebar`                    | `bg-sidebar`                      | `hsl(0 0% 100%)` | Sidebar 背景色，作为导航区域基底 |
| sidebar-foreground         | `--sidebar-foreground`         | `text-sidebar-foreground`         | `hsl(215 40% 12%)` | Sidebar 文字色，对比度 ≥ 4.5:1   |
| sidebar-primary            | `--sidebar-primary`            | `bg-sidebar-primary`              | `hsl(212 80% 45%)` | 激活态背景色                     |
| sidebar-primary-foreground | `--sidebar-primary-foreground` | `text-sidebar-primary-foreground` | `hsl(0 0% 100%)` | 激活态文字色，对比度 ≥ 4.5:1     |
| sidebar-accent             | `--sidebar-accent`             | `bg-sidebar-accent`               | `hsl(215 25% 95%)` | Hover 态背景，提供交互反馈       |
| sidebar-accent-foreground  | `--sidebar-accent-foreground`  | `text-sidebar-accent-foreground`  | `hsl(215 40% 12%)` | Hover 态文字                     |
| sidebar-border             | `--sidebar-border`             | `border-sidebar-border`           | `hsl(215 20% 88%)` | Sidebar 边框，维持整体风格       |
| sidebar-ring               | `--sidebar-ring`               | `ring-sidebar-ring`               | `hsl(212 80% 45%)` | 聚焦环颜色                       |

### 3.4 语义颜色（可选）

> 仅在需要状态反馈时定义（如表单验证、操作结果提示）。

| 用途        | CSS 变量          | HSL 值                  | 使用说明                   |
| ----------- | ----------------- | ----------------------- | -------------------------- |
| 成功/通过   | `--success`       | `hsl(145 63% 42%)`      | 审核通过、成功标识         |
| success-bg  | `--success-100`   | `hsl(145 63% 94%)`      | 成功状态背景               |
| 警告/待审核 | `--warning`       | `hsl(32 95% 44%)`       | 需要注意、待处理项         |
| warning-bg  | `--warning-100`   | `hsl(32 95% 94%)`       | 警告状态背景               |
| 错误/不通过 | `--destructive`   | `hsl(0 72% 51%)`        | 审核不通过、错误提示       |
| destructive-bg | `--destructive-100` | `hsl(0 72% 95%)`     | 错误状态背景               |
| 信息提示    | `--info`          | `hsl(212 80% 45%)`      | 信息提示、说明文字         |
| info-bg     | `--info-100`      | `hsl(212 80% 96%)`      | 信息背景                   |

## 4. Typography (字体排版)

- **Heading**: 思源黑体，系统字体栈 → `font-sans: ui-sans-serif, system-ui, -apple-system, "Noto Sans SC", "Source Han Sans SC", "Segoe UI", Roboto, sans-serif`
- **Body**: 思源黑体，系统字体栈 → `font-sans: ui-sans-serif, system-ui, -apple-system, "Noto Sans SC", "Source Han Sans SC", "Segoe UI", Roboto, sans-serif`
- **字体导入**: 使用系统自带中文字体，不引入外部字体

**排版层级**:
- 主标题: `text-2xl font-bold tracking-tight`
- 区块标题: `text-lg font-semibold`
- 标签文字: `text-sm font-medium`
- 正文/输入: `text-base`
- 辅助文字: `text-sm text-muted-foreground`
- 小字/帮助: `text-xs text-muted-foreground`

## 5. Layout Strategy (布局策略)

### 5.1 结构方向

**导航策略**：功能分为四个页面（首页、标签审核、标签生成、记录管理），功能模块清晰 → 采用侧边栏布局，侧边固定导航，方便快速切换功能

**页面架构特征**：数据编辑和审核工具，信息分组明确，需要足够空间展示表单和审核结果，采用侧边栏+主内容区布局，主内容区独立滚动

### 5.2 响应式原则

**断点策略**：
- 移动端（< 1024px）：侧边栏折叠为汉堡抽屉，点击展开
- 桌面端（≥ 1024px）：侧边栏常驻，完整展示导航

**内容密度**：
- 移动端：单列布局，增大点击区域，表单分组间距放大
- 桌面端：根据内容复杂度适当使用双列布局，提高空间利用率
- 所有可点击元素最小尺寸 ≥ 44px，满足触摸要求

**最大宽度**:
- 主内容区: `max-w-[1400px]`
- 表单编辑区: `max-w-3xl` 限制阅读宽度，避免行太长

## 6. Visual Language (视觉语言)

**形态特征**：
- 圆角: 柔和圆角 `rounded-lg (0.5rem)` 对卡片和容器，按钮使用 `rounded-md`
- 阴影: 柔和细微阴影 `shadow-sm` 对卡片，悬浮按钮使用 `shadow` 产生轻微层次感
- 边框: 细边框 `border` 分隔区块，保持清晰边界

**装饰策略**：
- 极简专业风格，不使用额外装饰元素
- 通过卡片分组、留白、色块对比建立视觉层次
- 仅在首页欢迎区可使用轻微渐变背景点缀，不干扰内容

**动效原则**：
- 交互反馈快速干脆，hover/focus 过渡时长 150ms
- 页面切换使用淡入淡出，避免夸张动画
- 上传进度和识别过程使用骨架屏加载状态

**状态设计规范**：
- **按钮**: Primary 按钮使用 `primary` 背景 + 白色文字，hover 加深主色明度；Secondary 按钮使用边框 + `accent` hover 背景
- **输入框**: 默认 `border-border`，focus 时 `border-primary` + `ring-1 ring-primary`，error 状态使用 `border-destructive`
- **卡片**: `bg-card` 白色背景，细微阴影，清晰边框
- **标签状态**: 通过语义颜色胶囊标签标识状态：通过(`success-bg text-success`)、不通过(`destructive-bg text-destructive`)、待审核(`warning-bg text-warning`)

**可及性保障**：
- 正文文字对比度 ≥ 4.5:1，所有配色满足 WCAG AA 标准
- 交互元素必须有 hover/focus 反馈，可点击区域清晰识别
- 审核结果中，不通过项使用语义颜色高亮，便于快速定位
- 文字大小可被浏览器缩放，不使用固定像素单位

**Spacing 间距规范**（遵循 Soft Blocks 风格 → spacious 间距）：
- 容器内边距: `p-6` ~ `p-8`
- 区块间距: `gap-6` ~ `gap-8`
- 卡片间距: `gap-4`
- 表单label与输入间距: `mb-2`