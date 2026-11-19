/* ==================================================================
 * OCR Provider —— 自带 OCR 适配层
 * ------------------------------------------------------------------
 * 本项目不内置、不绑定任何付费 OCR 服务。
 * 这里提供一个「兼容 OpenAI Chat Completions 格式」的通用实现作为示例。
 *
 * 你要接入自己的 OCR，有两种方式（任选其一）：
 *
 * 方式 A（推荐，最简单）：什么都不用改，只在 .env 里填自己的服务信息
 *   OCR_BASE_URL=https://你的服务地址/v1
 *   OCR_API_KEY=你的密钥
 *   OCR_VISION_MODEL=你的图片理解模型名
 *   支持：硅基流动、OpenAI、通义千问、本地 Ollama、vLLM、自建服务等，
 *   只要它提供 /chat/completions 接口并能看懂图片即可。
 *
 * 方式 B（完全自定义）：直接改写下面的 callOcr 函数。
 *   比如换成阿里云 OCR / 百度 OCR / Tesseract / 自研接口，
 *   只要最终返回 { JSON 对象 } 即可，业务代码一行都不用动。
 *
 * 未配置 OCR 时 hasOcrConfig() 返回 false，主程序会自动使用示例数据
 * 兜底，保证界面和流程可正常体验。
 * ================================================================== */
const axios = require('axios');

const BASE_URL = (process.env.OCR_BASE_URL || '').replace(/\/$/, '');
const API_KEY = process.env.OCR_API_KEY || '';
const VISION_MODEL = process.env.OCR_VISION_MODEL || '';
const TEXT_MODEL = process.env.OCR_TEXT_MODEL || VISION_MODEL;
const TIMEOUT_MS = Number(process.env.OCR_TIMEOUT_MS || 90000);

/** 是否已配置自有 OCR */
function hasOcrConfig() {
  return Boolean(BASE_URL && API_KEY && VISION_MODEL);
}

/**
 * 调用 OCR / 视觉大模型。
 * @param {Array}  messages  标准的 Chat Completions messages（可含 image_url）
 * @param {string} model     模型名，默认用视觉模型
 * @returns {Promise<object>} 从模型回复里解析出的 JSON 对象
 */
async function callOcr(messages, model = TEXT_MODEL) {
  if (!hasOcrConfig()) {
    throw new Error('未配置自带 OCR：请在 .env 中填写 OCR_BASE_URL / OCR_API_KEY / OCR_VISION_MODEL');
  }

  const resp = await axios.post(
    `${BASE_URL}/chat/completions`,
    {
      model: model || VISION_MODEL,
      messages,
      temperature: 0.1,
      max_tokens: 8192,
    },
    {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: TIMEOUT_MS,
    },
  );

  const content = resp.data?.choices?.[0]?.message?.content || '';
  const match = String(content).match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`OCR 服务未返回 JSON：${String(content).slice(0, 200)}`);
  return JSON.parse(match[0]);
}

module.exports = { callOcr, hasOcrConfig, VISION_MODEL, TEXT_MODEL };
