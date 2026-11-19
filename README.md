# 食品标签识别与合规审核系统

一个前后端分离的食品标签业务系统：上传食品标签图片和文档，自动识别并核对标签字段，做合规评分，生成/导出标签，并归档操作记录。

## 在线交互演示

**[👉 打开交互演示，子先体验](https://liu13754606161-netizen.github.io/)**

演示页面可像使用真实软件一样点选、上传、识别、核对、审核、导出。**纯前端演示，不调用任何付费 API、不需要任何密钥、不产生任何费用**——所有交互由浏览器本地逻辑与示例数据驱动，任何人打开即可体验。

> **关于 OCR**：本项目**不内置、不绑定任何付费 OCR 服务**，也不包含任何 API 密钥。识别能力由使用者自行提供（见下方「配置你自己的 OCR」）。没有配置时系统依然可以启动，识别接口会使用内置示例数据兜底，方便完整体验界面和流程。

---

## 功能

| 模块 | 说明 |
| --- | --- |
| 标签内容提取 | 上传标签图片 / 文档，识别后逐字段核对（图片值 vs 文档值），可编辑最终值并选择来源 |
| 标签内容展示 | 多食品卡片、厂商三类主体（供应商 / 委托方 / 被委托方）编辑、营养成分表、标签预览与导出 |
| 二次核对 | 原始值与人工更新值逐字段比对，差异项选择采用来源，导出最终结果 |
| 合规审核 | 按国标与企业标准双维度校验，扣分制自动评分，输出不合规项与整改建议 |
| 记录管理 | 按类型 / 状态筛选历史记录，查看详情 |

## 技术栈

- **前端**：React + TypeScript + Vite + Tailwind CSS
- **运行入口**：Node.js + Express（`server/local-server.js`，开箱即用）
- **平台版后端**：NestJS + Drizzle（可选，需对应平台框架）
- **文档解析**：pdf-parse、mammoth（本地解析 PDF / DOCX，无需云服务）
- **识别层**：可插拔 OCR Provider（`server/ocr-provider.js`）

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. （可选）配置你自己的 OCR，见下一节；不配也能启动体验
cp .env.example .env

# 3. 启动
npm start
```

浏览器打开 `http://127.0.0.1:3000`。

## 配置你自己的 OCR

识别能力集中在 **`server/ocr-provider.js`** 一个文件里，业务代码不感知具体 OCR 实现。两种方式任选：

### 方式 A：填配置，零代码改动（推荐）

复制 `.env.example` 为 `.env`，填写：

```ini
OCR_BASE_URL=https://你的服务地址/v1
OCR_API_KEY=你的API密钥
OCR_VISION_MODEL=你的图片理解模型名
```

任何兼容 OpenAI Chat Completions 格式的图片理解服务都可以接入，例如：

- 硅基流动：`https://api.siliconflow.cn/v1`
- OpenAI：`https://api.openai.com/v1`
- 本地 Ollama / vLLM：`http://127.0.0.1:11434/v1`

填好后在界面点识别，请求会带着图片走 `callOcr()` → 你的服务 → 解析成结构化字段返回。

### 方式 B：改代码，接入任意 OCR

直接改写 `server/ocr-provider.js` 里的 `callOcr(messages, model)` 函数。比如换成阿里云 OCR、百度 OCR、Tesseract 或自研接口——只要最终返回从识别结果里解析出的 **JSON 对象**即可，其余代码一行都不用动。

```js
async function callOcr(messages, model) {
  // 在这里调用你自己的 OCR
  // 返回 { manufacturerInfo: {...}, foodList: [...] } 之类的 JSON 对象
}
```

### 没配置会怎样？

`hasOcrConfig()` 返回 `false`，识别接口会自动使用内置示例数据（demo）兜底，界面和全流程照常可点、可体验，不会产生任何费用或外部请求。

## 目录结构

```
server/
  local-server.js          # 运行入口（Express，开箱即用）
  ocr-provider.js          # ★ 自带 OCR 适配层，改这里接入你的 OCR
  modules/                 # NestJS 平台版（可选）
shared/                    # 前后端共享类型与契约
client/                    # 前端 React 应用
.env.example               # 环境变量示例（仅占位符，无密钥）
```

## 安全说明

- 仓库中**没有任何 API 密钥**；`.env` 已被 `.gitignore` 忽略，不会被提交。
- 原项目中的第三方付费 OCR 调用（阿里云 OCR、平台 AI 插件等）已全部移除，替换为可插拔的自带 OCR 实现。
- 请勿把填写了真实密钥的 `.env` 提交或分享出去。
