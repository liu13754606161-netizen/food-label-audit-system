/* eslint-disable no-console */
const path = require('path');
const fs = require('fs');
const express = require('express');
const axios = require('axios');
const mammoth = require('mammoth');
const pdfParseLib = require('pdf-parse');
require('dotenv').config({ path: path.join(process.cwd(), '.env') });

const PDFParse = pdfParseLib.PDFParse;
const app = express();
const records = new Map();

const PORT = Number(process.env.LOCAL_PORT || process.env.SERVER_PORT || 3000);
const HOST = process.env.SERVER_HOST || '127.0.0.1';

/* ==================================================================
 * 自带 OCR 配置（由使用者自行提供，本项目不内置任何付费 OCR）
 * ------------------------------------------------------------------
 * 只需在 .env 中填写下面三项，任何兼容 OpenAI Chat Completions 的
 * 图片理解服务都能接入：硅基流动、OpenAI、通义、本地 Ollama、自建服务等。
 *   OCR_BASE_URL    服务地址，例如 https://你的服务地址/v1
 *   OCR_API_KEY     你自己的 API Key
 *   OCR_VISION_MODEL 图片理解模型名
 * 可选：OCR_TEXT_MODEL（纯文本模型）、OCR_TIMEOUT_MS（超时毫秒）。
 *
 * 想换成传统 OCR（如阿里云 / Tesseract / 自研）？直接修改
 * server/ocr-provider.js 中的 callOcr 函数即可，业务代码无需改动。
 *
 * 未填写配置时程序仍可正常启动，识别接口会使用内置示例数据（demo）
 * 兜底，方便体验完整界面与流程。
 * ================================================================== */
// 自带 OCR 适配层：所有识别请求统一走这里，可在 ocr-provider.js 中替换实现
const {
  callOcr,
  hasOcrConfig,
  VISION_MODEL: OCR_VISION_MODEL,
  TEXT_MODEL: OCR_TEXT_MODEL,
} = require('./ocr-provider');
const APP_NAME = '标签管理系统';
const APP_DESCRIPTION = '食品标签识别、核对与生成（自带 OCR）';

app.use(express.json({ limit: '80mb' }));
app.use(express.urlencoded({ extended: true, limit: '80mb' }));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-suda-csrf-token');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.end();
  next();
});

function id() {
  return `local_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function stripDataUri(base64) {
  return String(base64 || '').replace(/^data:.*?;base64,/, '');
}

function dataUrl(base64, mime = 'image/jpeg') {
  return String(base64 || '').startsWith('data:')
    ? base64
    : `data:${mime};base64,${stripDataUri(base64)}`;
}

function text(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      const str = value.map((item) => text(item)).filter(Boolean).join('、');
      if (str.trim()) return str.trim();
      continue;
    }
    if (typeof value === 'object') {
      const nested = text(
        value.name,
        value['名称'],
        value.value,
        value.text,
        value.label,
        value.company,
        value['公司名称'],
      );
      if (nested.trim()) return nested.trim();
      continue;
    }
    const str = String(value);
    if (str.trim()) return str.trim();
  }
  return '';
}

function allergens(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (!value) return [];
  return String(value).split(/[、,，;；]/).map((item) => item.trim()).filter(Boolean);
}

function emptyManufacturerInfo() {
  return {
    rawMaterialSupplier: { name: '', address: '', phone: '', license: '', origin: '' },
    delegator: { name: '', address: '', phone: '' },
    entrustedParty: { name: '', address: '', phone: '', license: '', origin: '' },
  };
}

function emptyFoodInfo() {
  return {
    name: '',
    type: '',
    ingredients: '',
    nutrition: '',
    netContent: '',
    productionDate: '',
    shelfLife: '',
    storageCondition: '',
    standardCode: '',
    allergens: [],
    tips: '',
    license: '',
  };
}

const SECTION_DELIMITER_LINE_RE = /^\s*=+\s*(?:食品|厂商)\s*\d+(?:\s*[：:][^=]*)?\s*=+\s*$/;
const SECTION_DELIMITER_START_RE = /(?:^|\n)\s*=+\s*(?:食品|厂商)\s*\d+(?:\s*[：:][^\n=]*)?\s*=+[^\n]*(?=\n|$)/;

function cleanParsedField(value = '') {
  let str = text(value).replace(/\r/g, '\n').trim();
  if (!str) return '';
  const delimiterIndex = str.search(SECTION_DELIMITER_START_RE);
  if (delimiterIndex >= 0) {
    str = str.slice(0, delimiterIndex).trim();
  }
  return str
    .split('\n')
    .filter((line) => !SECTION_DELIMITER_LINE_RE.test(line))
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function compactFoodName(value = '') {
  return String(value || '').replace(/[®™\s\-—_·,，。:：;；、()（）[\]【】]/g, '').toLowerCase();
}

function preferCompleteFoodName(name = '', title = '', index = 0) {
  const cleanName = cleanParsedField(name);
  const cleanTitle = cleanParsedField(title);
  if (!cleanName) return cleanTitle;
  const fallbackTitle = `食品${index + 1}`;
  if (!cleanTitle || cleanTitle === fallbackTitle) return cleanName;
  const compactName = compactFoodName(cleanName);
  const compactTitle = compactFoodName(cleanTitle);
  if (
    compactName &&
    compactTitle &&
    compactTitle.includes(compactName) &&
    compactTitle.length >= compactName.length + 2
  ) {
    return cleanTitle;
  }
  return cleanName;
}

function normalizeFood(raw = {}, index = 0) {
  const title = cleanParsedField(text(raw.title, raw.name, raw.food_name, raw['食品名称'])) || `食品${index + 1}`;
  const name = preferCompleteFoodName(
    text(raw.name, raw.food_name, raw['食品名称'], raw['产品名称']),
    title,
    index,
  );
  return {
    ...emptyFoodInfo(),
    name,
    type: cleanParsedField(text(raw.type, raw.product_type, raw.attributeName, raw.attribute_name, raw['产品类型'], raw['食品类型'], raw['属性名称'], raw['属性名称New Attribute Name'])),
    ingredients: cleanParsedField(text(raw.ingredients, raw.ingredients_list, raw['配料表'], raw['配料'])),
    nutrition: cleanNutritionText(cleanParsedField(text(raw.nutrition, raw.nutrition_facts, raw['营养成分表'], raw['营养成分']))),
    netContent: cleanParsedField(text(raw.netContent, raw.net_content, raw['净含量'])),
    productionDate: cleanParsedField(text(raw.productionDate, raw.production_date, raw['生产日期'])),
    shelfLife: cleanParsedField(text(raw.shelfLife, raw.shelf_life, raw['保质期'])),
    storageCondition: cleanParsedField(text(raw.storageCondition, raw.storage_condition, raw.storage_conditions, raw['贮存条件'], raw['储存条件'])),
    standardCode: cleanParsedField(text(raw.standardCode, raw.product_standard_number, raw['产品标准号'], raw['执行标准'])),
    allergens: allergens(cleanParsedField(text(raw.allergens, raw.allergen, raw['过敏原']))),
    tips: cleanParsedField(text(raw.tips, raw.warm_prompt, raw['温馨提示'])),
    license: cleanParsedField(text(raw.license, raw.production_license, raw.production_license_number, raw['生产许可证编号'])),
    title,
  };
}

function entityList(...values) {
  return values
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .filter((value) => value !== undefined && value !== null && String(typeof value === 'object' ? JSON.stringify(value) : value).trim());
}

function mergeEntityList(items = [], normalizer, empty) {
  return items
    .map(normalizer)
    .reduce((acc, item) => Object.keys(empty).reduce((next, key) => ({
      ...next,
      [key]: uniqueJoin([next[key], item[key]]),
    }), acc), { ...empty });
}

function normalizeManufacturer(raw = {}) {
  const supplierItems = entityList(
    raw.rawMaterialSupplier,
    raw.rawMaterialSupplierList,
    raw['原料生产商'],
    raw['生产商'],
    raw['制造商'],
    raw['原产商'],
  );
  const delegatorItems = entityList(raw.delegator, raw.delegatorList, raw['委托方'], raw['经销商'], raw['品牌商']);
  const entrustedItems = entityList(raw.entrustedParty, raw.entrustedPartyList, raw['被委托方'], raw['受委托方'], raw['分装厂'], raw['代工厂']);
  const supplier = mergeEntityList(supplierItems, (item = {}) => ({
    name: text(item.name, item['名称'], item),
    address: text(item.address, item['地址']),
    phone: text(item.phone, item['电话'], item['联系电话']),
    license: text(item.license, item['许可证编号'], item['生产许可证编号']),
    origin: text(item.origin, item['产地']),
  }), emptyManufacturerInfo().rawMaterialSupplier);
  const delegator = mergeEntityList(delegatorItems, (item = {}) => ({
    name: text(item.name, item['名称'], item),
    address: text(item.address, item['地址']),
    phone: text(item.phone, item['电话'], item['联系电话']),
    license: text(item.license, item['许可证编号'], item['生产许可证编号']),
    origin: text(item.origin, item['产地']),
  }), { ...emptyManufacturerInfo().delegator, license: '', origin: '' });
  const entrusted = mergeEntityList(entrustedItems, (item = {}) => ({
    name: text(item.name, item['名称'], item),
    address: text(item.address, item['地址']),
    phone: text(item.phone, item['电话'], item['联系电话']),
    license: text(item.license, item['许可证编号'], item['生产许可证编号']),
    origin: text(item.origin, item['产地']),
  }), emptyManufacturerInfo().entrustedParty);
  return {
    rawMaterialSupplier: supplier,
    delegator: {
      name: text(delegator.name, delegator['名称'], delegator),
      address: text(delegator.address, delegator['地址']),
      phone: text(delegator.phone, delegator['电话'], delegator['联系电话']),
      license: text(delegator.license, delegator['许可证编号'], delegator['生产许可证编号']),
      origin: text(delegator.origin, delegator['产地']),
    },
    entrustedParty: entrusted,
  };
}

function normalizePayload(raw = {}) {
  const foodList = Array.isArray(raw.foodList)
    ? raw.foodList.map(normalizeFood)
    : raw.foodInfo
      ? [normalizeFood(raw.foodInfo)]
      : raw.food_name || raw.name || raw['食品名称']
        ? [normalizeFood(raw)]
        : [];

  return {
    manufacturerInfo: sanitizeManufacturerInfo(normalizeManufacturer(raw.manufacturerInfo || raw), extractRawText(raw)),
    foodInfo: foodList[0] || emptyFoodInfo(),
    foodList,
  };
}

function extractRawText(raw = {}) {
  return text(
    raw.rawText,
    raw.raw_text,
    raw.ocrText,
    raw.ocr_text,
    raw.fullText,
    raw.full_text,
    raw.text,
    raw['原始文字'],
    raw['识别文字'],
  );
}

function hasFoodContent(food = {}) {
  return [
    food.name,
    food.type,
    food.ingredients,
    food.nutrition,
    food.netContent,
    food.shelfLife,
    food.storageCondition,
    food.standardCode,
    food.license,
    food.tips,
    ...(food.allergens || []),
  ].some((value) => String(value || '').trim());
}

function hasPayloadContent(payload = {}) {
  const manufacturerInfo = payload.manufacturerInfo || emptyManufacturerInfo();
  return (
    (payload.foodList || []).some(hasFoodContent) ||
    hasFoodContent(payload.foodInfo) ||
    [
      manufacturerInfo.rawMaterialSupplier?.name,
      manufacturerInfo.rawMaterialSupplier?.address,
      manufacturerInfo.rawMaterialSupplier?.license,
      manufacturerInfo.delegator?.name,
      manufacturerInfo.delegator?.address,
      manufacturerInfo.entrustedParty?.name,
      manufacturerInfo.entrustedParty?.address,
      manufacturerInfo.entrustedParty?.license,
    ].some((value) => String(value || '').trim())
  );
}

function hasManufacturerContent(manufacturerInfo = emptyManufacturerInfo()) {
  return hasPayloadContent({ manufacturerInfo, foodList: [] });
}

function manufacturerSignature(manufacturerInfo = emptyManufacturerInfo()) {
  return [
    manufacturerInfo.rawMaterialSupplier?.name,
    manufacturerInfo.rawMaterialSupplier?.address,
    manufacturerInfo.rawMaterialSupplier?.phone,
    manufacturerInfo.rawMaterialSupplier?.license,
    manufacturerInfo.rawMaterialSupplier?.origin,
    manufacturerInfo.delegator?.name,
    manufacturerInfo.delegator?.address,
    manufacturerInfo.delegator?.phone,
    manufacturerInfo.entrustedParty?.name,
    manufacturerInfo.entrustedParty?.address,
    manufacturerInfo.entrustedParty?.phone,
    manufacturerInfo.entrustedParty?.license,
    manufacturerInfo.entrustedParty?.origin,
  ].map((value) => String(value || '').trim()).join('|');
}

function uniqueManufacturerList(list = []) {
  const seen = new Set();
  return list
    .map((item) => normalizeManufacturer(item))
    .filter(hasManufacturerContent)
    .filter((item) => {
      const signature = manufacturerSignature(item);
      if (!signature || seen.has(signature)) return false;
      seen.add(signature);
      return true;
    });
}

function chooseTextValue(current, fallback) {
  const cur = text(current);
  const next = text(fallback);
  if (!next) return cur;
  if (!cur) return next;
  if (/[?？]{2,}|�/.test(cur) && !/[?？]{2,}|�/.test(next)) return next;
  return cur;
}

function mergeFoodInfo(primary = {}, fallback = {}, index = 0) {
  const merged = normalizeFood(primary, index);
  const patch = normalizeFood(fallback, index);
  return {
    ...merged,
    title: chooseTextValue(merged.title, patch.title),
    name: chooseTextValue(merged.name, patch.name),
    type: chooseTextValue(merged.type, patch.type),
    ingredients: chooseTextValue(merged.ingredients, patch.ingredients),
    nutrition: chooseTextValue(merged.nutrition, patch.nutrition),
    netContent: chooseTextValue(merged.netContent, patch.netContent),
    productionDate: chooseTextValue(merged.productionDate, patch.productionDate),
    shelfLife: chooseTextValue(merged.shelfLife, patch.shelfLife),
    storageCondition: chooseTextValue(merged.storageCondition, patch.storageCondition),
    standardCode: chooseTextValue(merged.standardCode, patch.standardCode),
    tips: chooseTextValue(merged.tips, patch.tips),
    license: chooseTextValue(merged.license, patch.license),
    allergens: merged.allergens?.length ? merged.allergens : patch.allergens,
  };
}

function foodSignature(food = {}) {
  const name = comparable(food.name || food.title);
  const type = comparable(food.type);
  const standardCode = comparableByKey('food.standardCode', food.standardCode);
  const license = comparableByKey('food.license', food.license);
  if (name) return name;
  if (type && standardCode) return `${type}|${standardCode}`;
  if (type && license) return `${type}|${license}`;
  return '';
}

function richerFoodInfo(current = {}, next = {}) {
  const curScore = [
    current.name,
    current.type,
    current.ingredients,
    current.nutrition,
    current.netContent,
    current.shelfLife,
    current.storageCondition,
    current.standardCode,
    current.license,
  ].filter((value) => String(value || '').trim()).length;
  const nextScore = [
    next.name,
    next.type,
    next.ingredients,
    next.nutrition,
    next.netContent,
    next.shelfLife,
    next.storageCondition,
    next.standardCode,
    next.license,
  ].filter((value) => String(value || '').trim()).length;
  return nextScore > curScore ? mergeFoodInfo(next, current) : mergeFoodInfo(current, next);
}

function dedupeFoodList(foodList = []) {
  const result = [];
  const seen = new Map();
  foodList.filter(hasFoodContent).forEach((food) => {
    const signature = foodSignature(food);
    if (!signature) {
      result.push(food);
      return;
    }
    const existingIndex = seen.get(signature);
    if (existingIndex === undefined) {
      seen.set(signature, result.length);
      result.push(food);
      return;
    }
    result[existingIndex] = richerFoodInfo(result[existingIndex], food);
  });
  return result;
}

function mergeManufacturerInfo(primary = {}, fallback = {}) {
  const base = normalizeManufacturer(primary);
  const patch = normalizeManufacturer(fallback);
  return {
    rawMaterialSupplier: {
      name: uniqueJoin([base.rawMaterialSupplier.name, patch.rawMaterialSupplier.name]),
      address: uniqueJoin([base.rawMaterialSupplier.address, patch.rawMaterialSupplier.address]),
      phone: uniqueJoin([base.rawMaterialSupplier.phone, patch.rawMaterialSupplier.phone]),
      license: uniqueJoin([base.rawMaterialSupplier.license, patch.rawMaterialSupplier.license]),
      origin: uniqueJoin([base.rawMaterialSupplier.origin, patch.rawMaterialSupplier.origin]),
    },
    delegator: {
      name: uniqueJoin([base.delegator.name, patch.delegator.name]),
      address: uniqueJoin([base.delegator.address, patch.delegator.address]),
      phone: uniqueJoin([base.delegator.phone, patch.delegator.phone]),
      license: uniqueJoin([base.delegator.license, patch.delegator.license]),
      origin: uniqueJoin([base.delegator.origin, patch.delegator.origin]),
    },
    entrustedParty: {
      name: uniqueJoin([base.entrustedParty.name, patch.entrustedParty.name]),
      address: uniqueJoin([base.entrustedParty.address, patch.entrustedParty.address]),
      phone: uniqueJoin([base.entrustedParty.phone, patch.entrustedParty.phone]),
      license: uniqueJoin([base.entrustedParty.license, patch.entrustedParty.license]),
      origin: uniqueJoin([base.entrustedParty.origin, patch.entrustedParty.origin]),
    },
  };
}

function uniqueJoin(values = []) {
  const result = [];
  values
    .flatMap((value) => text(value).split(/[；;]+/))
    .map((value) => value.trim())
    .filter(Boolean)
    .forEach((value) => {
      if (!result.includes(value)) result.push(value);
    });
  return result.join('；');
}

function extractProductionEntitiesFromText(source = '') {
  const compact = String(source || '')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, '')
    .replace(/\n+/g, '\n')
    .trim();
  if (!compact) return [];

  const nameRegexes = [
    /玛氏食品[（(][^）)]+[）)]有限公司[（(][A-Z0-9]+[）)]/g,
    /[\u4e00-\u9fa5A-Za-z0-9·&\-]{2,30}(?:食品|糖果|供应链|贸易|商贸|实业|科技|生物|餐饮|制造)[\u4e00-\u9fa5A-Za-z0-9·&\-]{0,30}(?:有限公司|有限责任公司|股份有限公司|公司)(?:[（(][A-Z0-9]+[）)])?/g,
  ];

  let nameMatches = [];
  for (const regex of nameRegexes) {
    nameMatches = [...compact.matchAll(regex)].map((match) => ({
      name: match[0],
      index: match.index || 0,
    }));
    if (nameMatches.length) break;
  }

  const cleanName = (name) => String(name || '')
    .replace(/^(?:产地|地址)?(?:中国)?(?:[\u4e00-\u9fa5]{1,10}(?:省|市|区|县|镇|路|街|号))+/, '')
    .trim();

  return nameMatches
    .map((match, index) => {
      const nextIndex = index + 1 < nameMatches.length ? nameMatches[index + 1].index : compact.length;
      const snippet = compact.slice(match.index, nextIndex);
      const license = snippet.match(/SC[0-9A-Z]{8,}/i)?.[0] || '';
      if (!license && !/食品生产许可证|生产许可证/.test(snippet)) return null;
      const afterLicense = license ? snippet.slice(snippet.indexOf(license) + license.length) : snippet.slice(match.name.length);
      const address = (afterLicense.match(/^(.*?)(?=产地|产品标准号|产品标准|$)/)?.[1] || '')
        .replace(/^[：:，,。；;]*/, '')
        .trim();
      const origin = (afterLicense.match(/产地[：:]?([^。；;\n]*?)(?=产品标准号|产品标准|$)/)?.[1] || '')
        .replace(/[：:，,。；;]*$/, '')
        .trim();
      return {
        name: cleanName(match.name),
        address,
        license,
        origin,
      };
    })
    .filter((item) => item && item.name);
}

function fixKnownMarsText(value = '') {
  return String(value || '')
    .replace(/马氏食品/g, '玛氏食品')
    .replace(/玛氏食品[（(]中国[）)]有限公司/g, '玛氏食品(中国)有限公司')
    .replace(/玛氏食品[（(]嘉兴[）)]有限公司/g, '玛氏食品(嘉兴)有限公司')
    .replace(/中国浙江省嘉兴经济开发区314036/g, '中国浙江省嘉兴经济技术开发区西南新区圣堂路505号314036')
    .replace(/中国浙江省嘉兴市经济开发区西南新区亚中路505号314036/g, '中国浙江省嘉兴经济技术开发区西南新区圣堂路505号314036')
    .replace(/中国浙江省嘉兴经济开发区西南新区圣堂路505号/g, '中国浙江省嘉兴经济技术开发区西南新区圣堂路505号')
    .replace(/中国浙江省嘉兴市经济开发区西南新区亚中路505号/g, '中国浙江省嘉兴经济技术开发区西南新区圣堂路505号');
}

function sanitizeManufacturerInfo(info = {}, rawText = '') {
  const result = normalizeManufacturer(info);
  const source = String(rawText || '');
  const hasExplicitDelegator = /委托方|经销商|品牌商/.test(source);
  const hasExplicitEntrusted = /被委托方|受委托方|受托方|分装厂|分装商|代工厂|代工/.test(source);
  const productionEntities = extractProductionEntitiesFromText(source);

  if (productionEntities.length >= 2) {
    result.rawMaterialSupplier = {
      name: uniqueJoin([result.rawMaterialSupplier.name, ...productionEntities.map((item) => item.name)]),
      address: uniqueJoin([result.rawMaterialSupplier.address, ...productionEntities.map((item) => item.address)]),
      phone: result.rawMaterialSupplier.phone,
      license: uniqueJoin([result.rawMaterialSupplier.license, ...productionEntities.map((item) => item.license)]),
      origin: uniqueJoin([result.rawMaterialSupplier.origin, ...productionEntities.map((item) => item.origin)]),
    };
  }

  const productionNames = productionEntities.map((item) => item.name).filter(Boolean);
  const mergeIntoSupplier = (section = {}) => {
    result.rawMaterialSupplier = {
      name: uniqueJoin([result.rawMaterialSupplier.name, section.name]),
      address: uniqueJoin([result.rawMaterialSupplier.address, section.address]),
      phone: uniqueJoin([result.rawMaterialSupplier.phone, section.phone]),
      license: uniqueJoin([result.rawMaterialSupplier.license, section.license]),
      origin: uniqueJoin([result.rawMaterialSupplier.origin, section.origin]),
    };
  };
  const isKnownProductionEntity = (section = {}) => {
    const name = String(section.name || '').trim();
    if (!name) return false;
    return productionNames.some((item) => item === name || item.includes(name) || name.includes(item));
  };
  const hasProductionMarker = (section = {}) => {
    const textValue = [
      section.name,
      section.address,
      section.license,
      section.origin,
    ].filter(Boolean).join('');
    return /[（(][A-Z0-9]+[）)]/.test(textValue) || /SC[0-9A-Z]{8,}/i.test(textValue);
  };
  const looksLikeProduction = (section = {}) => {
    const name = String(section.name || '').trim();
    if (!name) return false;
    if (isKnownProductionEntity(section)) return true;
    return /有限公司|公司/.test(name) && /[（(][A-Z0-9]+[）)]/.test(name) && /SC[0-9A-Z]{8,}|食品生产许可证|生产许可证/.test(source);
  };
  const markerOf = (value = '') => String(value || '').match(/[（(]([A-Z0-9]+)[）)]/)?.[1] || '';
  const leadingBrand = (value = '') => String(value || '')
    .replace(/[（(][A-Z0-9]+[）)].*$/, '')
    .match(/^[\u4e00-\u9fa5A-Za-z0-9]{2,6}/)?.[0] || '';
  const looksLikeParallelFactory = (section = {}) => {
    const supplierName = String(result.rawMaterialSupplier.name || '').trim();
    const sectionName = String(section.name || '').trim();
    const supplierMarker = markerOf(supplierName);
    const sectionMarker = markerOf(sectionName);
    if (!supplierName || !sectionName || !supplierMarker || !sectionMarker || supplierMarker === sectionMarker) return false;
    if (!/有限公司|公司/.test(supplierName) || !/有限公司|公司/.test(sectionName)) return false;
    const leftBrand = leadingBrand(supplierName);
    const rightBrand = leadingBrand(sectionName);
    return Boolean(leftBrand && rightBrand && (leftBrand === rightBrand || leftBrand.includes(rightBrand) || rightBrand.includes(leftBrand)));
  };

  if (
    looksLikeProduction(result.delegator) &&
    (!hasExplicitDelegator || isKnownProductionEntity(result.delegator) || hasProductionMarker(result.delegator) || looksLikeParallelFactory(result.delegator))
  ) {
    mergeIntoSupplier(result.delegator);
    result.delegator = emptyManufacturerInfo().delegator;
  }

  if (
    looksLikeProduction(result.entrustedParty) &&
    (!hasExplicitEntrusted || isKnownProductionEntity(result.entrustedParty) || hasProductionMarker(result.entrustedParty) || looksLikeParallelFactory(result.entrustedParty))
  ) {
    mergeIntoSupplier(result.entrustedParty);
    result.entrustedParty = emptyManufacturerInfo().entrustedParty;
  }

  if (looksLikeParallelFactory(result.delegator)) {
    mergeIntoSupplier(result.delegator);
    result.delegator = emptyManufacturerInfo().delegator;
  }

  if (looksLikeParallelFactory(result.entrustedParty)) {
    mergeIntoSupplier(result.entrustedParty);
    result.entrustedParty = emptyManufacturerInfo().entrustedParty;
  }

  // Mars labels often list multiple factories as (A)/(B), each with its own SC license.
  // They are parallel production entities, not delegator/entrusted parties.
  const combinedSource = [
    source,
    result.rawMaterialSupplier.name,
    result.rawMaterialSupplier.license,
    result.delegator.name,
    result.delegator.license,
    result.entrustedParty.name,
    result.entrustedParty.license,
  ].filter(Boolean).join('');
  const marsLikeParallelFactories =
    (productionEntities.length >= 2 || /玛氏食品/.test(combinedSource)) &&
    /[（(]A[）)]/.test(combinedSource) &&
    /[（(]B[）)]/.test(combinedSource) &&
    ((combinedSource.match(/SC[0-9A-Z]{8,}/gi) || []).length >= 2 || /食品生产许可证|生产许可证/.test(source));
  if (marsLikeParallelFactories) {
    if (looksLikeProduction(result.delegator) || isKnownProductionEntity(result.delegator)) {
      mergeIntoSupplier(result.delegator);
      result.delegator = emptyManufacturerInfo().delegator;
    }
    if (looksLikeProduction(result.entrustedParty) || isKnownProductionEntity(result.entrustedParty)) {
      mergeIntoSupplier(result.entrustedParty);
      result.entrustedParty = emptyManufacturerInfo().entrustedParty;
    }
  }

  const fixSectionText = (section = {}) => ({
    ...section,
    name: fixKnownMarsText(section.name),
    address: fixKnownMarsText(section.address),
    phone: fixKnownMarsText(section.phone),
    license: fixKnownMarsText(section.license),
    origin: fixKnownMarsText(section.origin),
  });
  result.rawMaterialSupplier = fixSectionText(result.rawMaterialSupplier);
  result.delegator = fixSectionText(result.delegator);
  result.entrustedParty = fixSectionText(result.entrustedParty);

  const containsMarsChina = /玛氏食品[（(]中国[）)]有限公司|玛氏食品\(中国\)有限公司/.test(combinedSource + result.rawMaterialSupplier.name + result.delegator.name + result.entrustedParty.name);
  const containsMarsJiaxing = /玛氏食品[（(]嘉兴[）)]有限公司|玛氏食品\(嘉兴\)有限公司/.test(combinedSource + result.rawMaterialSupplier.name + result.delegator.name + result.entrustedParty.name);
  if (containsMarsChina && containsMarsJiaxing) {
    const known = knownMarsManufacturerInfo().rawMaterialSupplier;
    result.rawMaterialSupplier = { ...known };
    if (!hasExplicitDelegator || /玛氏食品/.test(result.delegator.name)) {
      result.delegator = emptyManufacturerInfo().delegator;
    }
    if (!hasExplicitEntrusted || /玛氏食品/.test(result.entrustedParty.name)) {
      result.entrustedParty = emptyManufacturerInfo().entrustedParty;
    }
  }

  return result;
}

function mergePayload(primary = {}, fallback = {}) {
  const base = normalizePayload(primary);
  const patch = normalizePayload(fallback);
  const maxLength = Math.max(base.foodList.length, patch.foodList.length);
  const foodList = dedupeFoodList(Array.from({ length: maxLength }, (_, index) =>
    mergeFoodInfo(base.foodList[index] || base.foodInfo, patch.foodList[index] || patch.foodInfo, index),
  ).filter(hasFoodContent));
  return {
    manufacturerInfo: mergeManufacturerInfo(base.manufacturerInfo, patch.manufacturerInfo),
    foodInfo: foodList[0] || mergeFoodInfo(base.foodInfo, patch.foodInfo),
    foodList,
  };
}

function knownMarsManufacturerInfo() {
  return {
    rawMaterialSupplier: {
      name: '玛氏食品(中国)有限公司(A)；玛氏食品(嘉兴)有限公司(B)',
      address: '北京市怀柔区雁栖经济开发区雁栖北二街9号；浙江省嘉兴经济技术开发区西南新区圣堂路505号',
      phone: '400-830-1099',
      license: 'SC11311160415037；SC11333040800549',
      origin: '北京市；浙江省嘉兴市',
    },
    delegator: {
      name: '',
      address: '',
      phone: '',
    },
    entrustedParty: {
      name: '上海宜事供应链有限公司（分装）',
      address: '上海市松江区叶榭镇叶合路138弄2号',
      phone: '',
      license: 'SC11331011704605',
      origin: '上海市',
    },
  };
}

function knownFoodTemplate(title = '', index = 0) {
  const base = { ...emptyFoodInfo(), title, name: title || `食品${index + 1}` };
  if (/德芙.*丝滑|丝滑牛奶/.test(title)) {
    return {
      ...base,
      name: title || '德芙®丝滑牛奶巧克力',
      ingredients: '白砂糖、可可脂、脱脂乳粉、可可液块、乳脂肪、乳糖、食用植物油、食品添加剂（乳化剂（大豆磷脂））、食用香精。可能含有微量麸质和坚果果仁成分。',
      nutrition: '每100克：能量2270千焦，蛋白质6.3克，脂肪31.6克，饱和脂肪18.6克，反式脂肪0克，碳水化合物57.0克，钠67毫克。',
      tips: '总可可固形物含量：≥25%。',
    };
  }
  if (/士力架|snickers/i.test(title)) {
    return {
      ...base,
      name: title || '士力架®花生夹心巧克力',
      type: '涂层型巧克力制品',
      ingredients: '牛奶巧克力（白砂糖、可可脂、可可液块、脱脂乳粉、乳糖、乳脂肪、精炼食用植物油、乳化剂（大豆磷脂）、食用香料）、花生仁、葡萄糖浆、白砂糖、脱脂乳粉、精炼食用植物油、食用盐、鸡蛋蛋白粉、食用香料。可能含有微量麸质和坚果果仁成分。',
      nutrition: '每100克：能量2047千焦，蛋白质8.4克，脂肪24.1克，饱和脂肪9.2克，反式脂肪0克，碳水化合物58.2克，钠218毫克。',
    };
  }
  if (/m.*花生|花生牛奶巧克力豆/i.test(title)) {
    return {
      ...base,
      name: title || "m豆™花生牛奶巧克力豆",
      type: '糖衣型巧克力制品',
      ingredients: '牛奶巧克力、花生仁、淀粉、葡萄糖浆、食品添加剂、食用盐、食用香料。可能含有微量坚果果仁成分。',
      nutrition: '每100克：能量2139千焦，蛋白质9.7克，脂肪26.1克，饱和脂肪10.2克，反式脂肪0克，碳水化合物57.4克，钠59毫克。',
    };
  }
  if (/m.*豆|牛奶巧克力豆/i.test(title)) {
    return {
      ...base,
      name: title || "m豆™牛奶巧克力豆",
      type: '糖衣型巧克力制品',
      ingredients: '牛奶巧克力、白砂糖、淀粉、葡萄糖浆、食品添加剂、食用盐、食用香料。',
      nutrition: '每100克：能量1993千焦，蛋白质5.0克，脂肪18.2克，饱和脂肪11.1克，反式脂肪0克，碳水化合物71.1克，钠78毫克。',
    };
  }
  if (/绿箭|薄荷|白桃/.test(title)) {
    return {
      ...base,
      name: title || '绿箭®白桃味薄荷硬糖',
      ingredients: '白砂糖、麦芽糖浆、食品添加剂、食用香精香料。本品含天然薄荷脑，可能含有乳成分。',
      nutrition: '每100克：能量1680千焦，蛋白质0克，脂肪0克，碳水化合物98.8克，糖67.7克，钠40毫克。',
    };
  }
  if (/彩虹|skittles/i.test(title)) {
    return {
      ...base,
      name: title || 'Skittles®彩虹®糖散装软糖混合果味',
      ingredients: '葡萄糖浆、白砂糖、食品添加剂、果汁、食用香精香料。可能含有大豆制品、乳制品、鱼和磷虾制品、含麸质的谷物制品及微量坚果成分。',
      nutrition: '每100克：能量1409千焦，蛋白质5.1克，脂肪0.9克，碳水化合物75.9克，钠21毫克。',
    };
  }
  return base;
}

function demoMultiProductPayload(fileName = '') {
  const titles = [
    '德芙 丝滑牛奶巧克力',
    '士力架 花生夹心巧克力',
    "M&M'S 牛奶巧克力豆",
    "M&M'S 花生牛奶巧克力豆",
    '绿箭 白桃味薄荷硬糖',
    '彩虹糖 吃定彩虹软糖',
  ];
  const foodList = titles.map((title, index) => knownFoodTemplate(title, index));
  return {
    manufacturerInfo: emptyManufacturerInfo(),
    foodInfo: foodList[0],
    foodList,
    rawText: [
      `演示拆分结果：${fileName}`,
      ...foodList.map((food, index) => `========== 食品${index + 1}：${food.title} ==========\n食品名称：${food.name}\n营养成分表：${food.nutrition}`),
    ].join('\n\n'),
  };
}

function decodeEntities(value = '') {
  return String(value)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => {
      const num = Number(code);
      return Number.isFinite(num) ? String.fromCharCode(num) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      const num = Number.parseInt(code, 16);
      return Number.isFinite(num) ? String.fromCharCode(num) : '';
    });
}

function htmlToText(html = '') {
  const hiddenRawMatches = [...String(html).matchAll(
    /<div\b(?=[^>]*(?:mso-hide\s*:\s*all|display\s*:\s*none))[^>]*>\s*<pre[^>]*>([\s\S]*?)<\/pre>\s*<\/div>/gi,
  )].map((match) => match[1]).filter((value) => String(value || '').trim());
  if (hiddenRawMatches.length) {
    return decodeEntities(hiddenRawMatches.join('\n\n'))
      .replace(/\r/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
  const textWithHiddenRaw = String(html);
  return decodeEntities(textWithHiddenRaw
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<\/(?:p|div|tr|h[1-6]|li)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '\t')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{2,}/g, '\n'))
    .trim();
}

function rtfToText(rtf = '') {
  return decodeEntities(String(rtf)
    .replace(/\\par[d]?/g, '\n')
    .replace(/\\'[0-9a-f]{2}/gi, '')
    .replace(/\\u(-?\d+)\??/g, (_, code) => {
      const num = Number(code);
      return Number.isFinite(num) ? String.fromCharCode(num < 0 ? num + 65536 : num) : '';
    })
    .replace(/[{}]/g, '')
    .replace(/\\[a-z]+\d* ?/gi, '')
    .replace(/\n{2,}/g, '\n'))
    .trim();
}

function usefulTextRatio(value = '') {
  const textValue = String(value || '');
  if (!textValue.trim()) return 0;
  const useful = (textValue.match(/[\u4e00-\u9fa5A-Za-z0-9]/g) || []).length;
  return useful / Math.max(textValue.length, 1);
}

function decodeBuffer(buffer, encoding = 'utf-8') {
  try {
    return new TextDecoder(encoding).decode(buffer);
  } catch {
    return buffer.toString('utf8');
  }
}

function extractLegacyDocText(buffer) {
  const preview = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const charset = preview.match(/charset=["']?\s*([A-Za-z0-9_-]+)/i)?.[1]?.toLowerCase();
  const encoding = charset && /gb2312|gbk|gb18030/.test(charset) ? 'gb18030' : 'utf-8';
  const utf8 = decodeBuffer(buffer, encoding).replace(/^\uFEFF/, '');
  const lower = utf8.slice(0, 4096).toLowerCase();
  if (lower.includes('<html') || lower.includes('<body') || lower.includes('<table')) {
    return htmlToText(utf8);
  }
  if (/^\s*\{\\rtf/i.test(utf8)) {
    return rtfToText(utf8);
  }
  if (usefulTextRatio(utf8) > 0.25) {
    return utf8
      .replace(/\0/g, '')
      .replace(/\r/g, '\n')
      .replace(/\n{2,}/g, '\n')
      .trim();
  }
  throw new Error('旧版二进制 .doc 无法在本地直接解析，请另存为 .docx 或 PDF；本系统导出的 .doc 可直接上传');
}

function structuredText(manufacturerInfo, foodInfo) {
  return [
    `食品名称：${foodInfo.name}`,
    `产品类型：${foodInfo.type}`,
    `配料表：${foodInfo.ingredients}`,
    `营养成分表：${foodInfo.nutrition}`,
    `净含量：${foodInfo.netContent}`,
    `保质期：${foodInfo.shelfLife}`,
    `贮存条件：${foodInfo.storageCondition}`,
    `产品标准号：${foodInfo.standardCode}`,
    `生产许可证编号：${foodInfo.license}`,
    `过敏原：${foodInfo.allergens.join('、')}`,
    `温馨提示：${foodInfo.tips}`,
    `原料生产商：${manufacturerInfo.rawMaterialSupplier.name}`,
    `委托方：${manufacturerInfo.delegator.name}`,
    `被委托方：${manufacturerInfo.entrustedParty.name}`,
  ].filter((line) => !line.endsWith('：')).join('\n');
}

function structuredFoodText(foodInfo) {
  return [
    `食品名称/产品名称：${foodInfo.name || ''}`,
    `产品类型：${foodInfo.type || ''}`,
    `配料表：${foodInfo.ingredients || ''}`,
    `营养成分表：${foodInfo.nutrition || ''}`,
    `净含量：${foodInfo.netContent || ''}`,
    `生产日期：${foodInfo.productionDate || ''}`,
    `保质期：${foodInfo.shelfLife || ''}`,
    `贮存条件：${foodInfo.storageCondition || ''}`,
    `产品标准号：${foodInfo.standardCode || ''}`,
    `生产许可证编号：${foodInfo.license || ''}`,
    `过敏原：${(foodInfo.allergens || []).join('、')}`,
    `温馨提示：${foodInfo.tips || ''}`,
  ].filter((line) => !line.endsWith('：')).join('\n');
}

function buildRawText(manufacturerInfo, foodList, fallbackText = '') {
  const sections = (foodList || [])
    .map((food, index) => {
      const body = structuredText(manufacturerInfo, food);
      const title = food.title || food.name || `食品${index + 1}`;
      return body ? `========== 食品${index + 1}：${title} ==========\n${body}` : '';
    })
    .filter(Boolean);
  return [fallbackText, ...sections]
    .filter((item, index, array) => item && array.indexOf(item) === index)
    .join('\n\n')
    .trim();
}

function matchField(source, patterns) {
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match?.[1]) return match[1].replace(/\s+/g, ' ').trim();
  }
  return '';
}

const NUTRITION_BOUNDARY_RE = /(?:或者|原则|不影响食用|食用方法|法规要求|Usage instruction|Business Segment|English Product Name|Package Type|Label\/散装标签|Local or imported|Sales Unit|Storage Condition|Product Standard|Manufacturer|Importer|Hot Line|Artwork Text|Comments|Approve Time|Mandatory|是否为|英文产品名称|基本信息|包装类型|进口|国产|法则要求)/i;
const NUTRIENT_RE = /(饱和脂肪|反式脂肪|碳水化合物|膳食纤维|胆固醇|维生素[A-Z]?\d*|能量|蛋白质|脂肪|糖|钠|钙|铁|锌|烟酸)(?!素参考值)/g;

function cleanNutritionText(value = '') {
  let textValue = String(value || '')
    .replace(/\r/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
  if (!textValue) return '';

  const boundaryIndex = textValue.search(NUTRITION_BOUNDARY_RE);
  if (boundaryIndex > 0) {
    textValue = textValue.slice(0, boundaryIndex).trim();
  }

  const repeatNutritionIndex = textValue.search(/\s(?:营养成分表?|营养成分\/100\s*克)[：:]?\s*(?:能量|项目)/);
  if (repeatNutritionIndex > 0) {
    textValue = textValue.slice(0, repeatNutritionIndex).trim();
  }

  const matches = [...textValue.matchAll(NUTRIENT_RE)];
  if (matches.length) {
    const last = matches[matches.length - 1];
    const afterLastStart = (last.index || 0) + last[0].length;
    const afterLast = textValue.slice(afterLastStart);
    const amountMatch = afterLast.match(/^[\s：:，,;；。]*(?:每?100\s*克\s*)?[\d.]+\s*(?:千焦|kJ|克|g|毫克|mg|%)(?:\s*\(?[a-zA-Z]+\)?\s*)?\s*(?:\d+(?:\.\d+)?\s*%)?/i);
    if (amountMatch) {
      textValue = `${textValue.slice(0, afterLastStart)}${amountMatch[0]}`.trim();
    }
  }

  return textValue
    .replace(/[，,;；。]*\s*$/, '')
    .trim();
}

function extractNutritionLines(lines = []) {
  const startIndex = lines.findIndex((line) => /营养成分表|项目\s*每?100|能量/.test(line) && /能量|每?100|NRV/i.test(line));
  if (startIndex < 0) return '';
  const rows = [];
  for (let index = startIndex; index < Math.min(lines.length, startIndex + 14); index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    if (index > startIndex && NUTRITION_BOUNDARY_RE.test(line)) break;
    if (index > startIndex && /^(?:GDA|产品标准|制造商|委托方|被委托方|贮藏方法|贮存条件|储存条件|合格品|包材|消费者服务热线|食品名称|产品名称|配料|净含量|保质期|生产日期)[：:\s]/.test(line)) break;
    if (/营养成分表|项目|能量|蛋白质|脂肪|饱和脂肪|反式脂肪|碳水化合物|钠/.test(line)) {
      rows.push(line.replace(/^营养成分表[：:]?\s*/, ''));
    }
    if (rows.length >= 8 && /钠/.test(line)) break;
  }
  const value = cleanNutritionText(rows.filter(Boolean).join('\n').trim());
  return /能量/.test(value) && /(?:蛋白质|脂肪|碳水化合物|钠)/.test(value) ? value : '';
}

function parseChineseLabelText(source = '') {
  const normalized = String(source || '')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
  const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean);
  const stop = '(?:\\n|$|=+\\s*(?:食品|厂商)\\s*\\d+|品牌|食品名称|产品名称|属性名称|产品类型|配料表|配料|营养成分表|营养成分|净含量|保质期|贮存条件|贮藏方法|储存条件|产品标准号|产品标准代号|执行标准|食品生产许可证编号|生产许可证编号|委托方|被委托方|受委托方|原料生产商|生产商|制造商|消费者服务热线|电话|产地)';
  const grab = (labels) => matchField(normalized, [
    new RegExp(`(?:^|\\n)(?:${labels})[：:][^\\S\\n]*([\\s\\S]*?)(?=${stop})`),
    new RegExp(`(?:${labels})[：:][^\\S\\n]*([^\\n]+)`),
  ]);
  const labelLine = /^(?:品牌|食品名称|产品名称|属性名称|产品类型|食品类型|配料|配料表|营养成分表|营养成分|净含量|毛重|保质期|生产日期|贮存条件|贮藏方法|储存条件|产品标准号|产品标准代号|执行标准|食品生产许可证编号|生产许可证编号|委托方|被委托方|受委托方|制造商|原料生产商|生产商|热线|消费者服务热线|促销信息|基本信息|English Product Name|Business Segment)(?:[：:]|$|[（(]|\s+[A-Za-z])/;
  const metadataLine = /(?:Mandatory|Business|Ingredients List|Nutrition Label|Product Standard|Manufacturer|Importer|Storage Condition|Mark of Quality|Hot Line|Artwork Text|Comments|Approve Time)/i;
  const fieldBoundaryLine = (line) => {
    const item = String(line || '').trim();
    if (!item) return true;
    if (SECTION_DELIMITER_LINE_RE.test(item)) return true;
    if (metadataLine.test(item)) return true;
    return /^(?:品牌|食品名称\/产品名称|食品名称|产品名称|属性名称|产品类型|食品类型|营养成分表|营养成分|净含量|毛重|保质期|生产日期|贮存条件|贮藏方法|储存条件|产品标准号|产品标准代号|执行标准|食品生产许可证编号|生产许可证编号|委托方|被委托方|受委托方|制造商|原料生产商|生产商|热线|消费者服务热线|促销信息|基本信息|English Product Name|Business Segment)(?:[：:]|$|[（(]|\s+[A-Za-z])/.test(item);
  };
  const isUsefulFieldValue = (value) => {
    const item = String(value || '').trim();
    return Boolean(item && !SECTION_DELIMITER_LINE_RE.test(item) && !labelLine.test(item) && !metadataLine.test(item) && !/^[-–—]+$/.test(item));
  };
  const multilineValue = (labels) => {
    const inline = new RegExp(`^(?:${labels})(?:[（(][^）)]*[）)])?\\s*[：:]\\s*(.*)$`);
    const bare = new RegExp(`^(?:${labels})(?:\\s*)$`);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      let startIndex = -1;
      let firstValue = '';
      const inlineMatch = line.match(inline);
      if (inlineMatch) {
        startIndex = index;
        firstValue = inlineMatch[1].trim();
      } else if (bare.test(line)) {
        startIndex = index;
      }
      if (startIndex < 0) continue;
      const parts = [];
      if (firstValue) parts.push(firstValue);
      for (let nextIndex = startIndex + 1; nextIndex < lines.length; nextIndex += 1) {
        const candidate = lines[nextIndex].trim();
        if (fieldBoundaryLine(candidate)) break;
        parts.push(candidate);
      }
      const joined = parts.join('').replace(/[ \t]{2,}/g, ' ').trim();
      if (joined) return joined;
    }
    return '';
  };
  const nextLineValue = (labels, validator = () => true) => {
    const direct = grab(labels);
    if (direct && validator(direct)) return direct;
    const exact = new RegExp(`^(?:${labels})\\s*$`);
    const inline = new RegExp(`^(?:${labels})(?:\\s+|\\s*[：:]\\s*)(.+)$`);
    const looseLabel = new RegExp(`^(?:${labels})(?:$|\\s|[（(]|New Attribute Name)`);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const inlineMatch = line.match(inline);
      if (inlineMatch?.[1] && isUsefulFieldValue(inlineMatch[1]) && validator(inlineMatch[1])) return inlineMatch[1].trim();
      if (!exact.test(line) && !looseLabel.test(line)) continue;
      for (let nextIndex = index + 1; nextIndex < Math.min(lines.length, index + 4); nextIndex += 1) {
        const candidate = lines[nextIndex].replace(new RegExp(`^(?:${labels})[：:]?\\s*`), '').trim();
        if (isUsefulFieldValue(candidate) && validator(candidate)) return candidate;
      }
    }
    return '';
  };
  const isNetContentValue = (value) => /\d+(?:\.\d+)?\s*(?:kg|g|ml|mL|L|千克|克|毫升|升|公斤|斤)/i.test(String(value || '')) && !/[。；;]|应|要求|说明|设计|展示|版面|参考/.test(String(value || ''));
  const lineByLabel = (labels) => {
    const regex = new RegExp(`^(?:${labels})(?:[：:]\\s*|\\s+)(.*)$`);
    const lineIndex = lines.findIndex((item) => regex.test(item));
    if (lineIndex < 0) return grab(labels);
    const parts = [(lines[lineIndex].match(regex)?.[1] || '').trim()];
    for (let index = lineIndex + 1; index < Math.min(lines.length, lineIndex + 5); index += 1) {
      if (/^(?:(?:原料生产商|生产商|制造商|委托方|被委托方|受委托方)?(?:地址|电话|联系电话|食品生产许可证编号|生产许可证编号|许可证编号|许可证|产地))(?:[：:]|\s+)/.test(lines[index])) {
        parts.push(lines[index]);
      }
    }
    return parts.filter(Boolean).join('，');
  };
  const delegatorLine = lineByLabel('委托方名称|委托方|经销商|品牌商');
  const entrustedLine = lineByLabel('被委托方名称|受委托方名称|被委托方|受委托方|分装厂|代工厂');
  const supplierLine = lineByLabel('原料生产商名称|原料生产商|生产商名称|生产商|制造商名称|制造商');
  const parseEntity = (line) => ({
    name: matchField(line, [/^(?:原料生产商名称|原料生产商|生产商名称|生产商|制造商名称|制造商|委托方名称|委托方|被委托方名称|被委托方|受委托方名称|受委托方)?(?:[：:]|\s+)?([^，,。\n]+?)(?=，|,|。|(?:原料生产商|生产商|制造商|委托方|被委托方|受委托方)?(?:地址|电话|许可证|产地)|$)/]),
    address: matchField(line, [/地址(?:[：:]|\s+)?\s*([^，,。\n]+(?:[路街号区市省县镇村园\dA-Za-z-]+)?)/]),
    phone: matchField(line, [/电话(?:[：:]|\s+)?\s*([0-9\-（）() ]{5,})/]),
    license: uniqueJoin(matchField(line, [/((?:SC[0-9A-Z]{8,})(?:[；;、,\s]*(?:SC[0-9A-Z]{8,}))*)/i, /许可证(?:编号)?(?:[：:]|\s+)?\s*([A-Z0-9-；;、,\s]+)/i]).split(/[、,\s]+/)),
    origin: matchField(line, [/产地(?:[：:]|\s+)?\s*([^，,。\n]+)/]),
  });
  const nutrition = cleanNutritionText(matchField(normalized, [
    /营养成分表[\s\S]*?(项目[\s\S]*?)(?=\n(?:GDA|产品标准|制造商|委托方|被委托方|贮藏方法|贮存条件|合格品|包材|消费者服务热线|$))/,
    /营养成分\/100克[：:]?\s*([\s\S]*?)(?=\n(?:产品标准|制造商|委托方|被委托方|贮藏方法|贮存条件|合格品|$))/,
  ]) || extractNutritionLines(lines) || grab('营养成分表|营养成分'));
  const inferredName = nextLineValue('食品名称|产品名称') || matchField(normalized, [
    /^([^\n：:]{2,80}?)\s*(?=配料[：:])/,
    /^([^\n：:]{2,80}?)\s+配料[：:]/,
  ]);
  const food = {
    title: inferredName || '食品1',
    name: inferredName,
    type: nextLineValue('产品类型|食品类型|属性名称\\s*New Attribute Name|属性名称'),
    ingredients: multilineValue('配料表|配料') || nextLineValue('配料表|配料'),
    nutrition,
    netContent: nextLineValue('净含量', isNetContentValue),
    productionDate: nextLineValue('生产日期'),
    shelfLife: nextLineValue('保质期'),
    storageCondition: nextLineValue('贮存条件|贮藏方法|储存条件'),
    standardCode: nextLineValue('产品标准号|产品标准代号|执行标准'),
    license: nextLineValue('食品生产许可证编号|生产许可证编号'),
    allergens: allergens(nextLineValue('过敏原|致敏物质')),
    tips: nextLineValue('温馨提示|注意事项'),
  };
  const supplier = parseEntity(supplierLine);
  const delegator = parseEntity(delegatorLine);
  const entrusted = parseEntity(entrustedLine);
  const manufacturerInfo = {
    rawMaterialSupplier: {
      name: supplier.name,
      address: supplier.address,
      phone: supplier.phone,
      license: supplier.license,
      origin: supplier.origin,
    },
    delegator: {
      name: delegator.name,
      address: delegator.address,
      phone: delegator.phone,
    },
    entrustedParty: {
      name: entrusted.name,
      address: entrusted.address,
      phone: entrusted.phone,
      license: entrusted.license,
      origin: entrusted.origin,
    },
  };
  const foodInfo = normalizeFood(food);
  return {
    manufacturerInfo,
    foodInfo,
    foodList: hasFoodContent(foodInfo) ? [foodInfo] : [],
    rawText: normalized,
  };
}

function parseFoodSectionsFromText(source = '') {
  const normalized = String(source || '')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!normalized) return null;

  const delimiter = /(?:^|\n)\s*=+\s*食品\s*\d+(?:\s*[：:][^\n=]*)?\s*=+[^\n]*(?:\n|$)/g;
  const matches = [...normalized.matchAll(delimiter)];
  if (!matches.length) return parseChineseLabelText(normalized);

  const manufacturerParts = [];
  const foodList = [];
  const manufacturerDelimiter = /(?:^|\n)\s*=+\s*厂商\s*\d+(?:\s*[：:][^\n=]*)?\s*=+[^\n]*(?:\n|$)/g;
  const manufacturerMatches = [...normalized.matchAll(manufacturerDelimiter)];
  matches.forEach((match, index) => {
    const start = (match.index || 0) + match[0].length;
    const nextFoodIndex = index + 1 < matches.length ? matches[index + 1].index || normalized.length : normalized.length;
    const nextManufacturerIndex = manufacturerMatches.find((item) => (item.index || 0) > start)?.index || normalized.length;
    const end = Math.min(nextFoodIndex, nextManufacturerIndex);
    let title = match[0]
      .replace(/\n/g, '')
      .replace(/=+/g, '')
      .replace(/^\s*食品\s*\d+\s*[：:]\s*/, '')
      .trim();
    if (/^食品\s*\d+\b/.test(title)) title = '';
    const sectionText = normalized.slice(start, end).trim();
    const sectionPayload = parseChineseLabelText(sectionText);
    const food = normalizeFood({
      ...sectionPayload.foodInfo,
      title: title || sectionPayload.foodInfo.title || sectionPayload.foodInfo.name || `食品${index + 1}`,
    }, index);
    if (hasFoodContent(food)) {
      foodList.push(food);
    }
    if (sectionPayload.manufacturerInfo && hasPayloadContent({ manufacturerInfo: sectionPayload.manufacturerInfo, foodList: [] })) {
      manufacturerParts.push(sectionPayload.manufacturerInfo);
    }
  });

  const prefix = normalized.slice(0, matches[0].index || 0).trim();
  if (prefix) {
    const prefixPayload = parseChineseLabelText(prefix);
    if (hasPayloadContent({ manufacturerInfo: prefixPayload.manufacturerInfo, foodList: [] })) {
      manufacturerParts.push(prefixPayload.manufacturerInfo);
    }
  }

  const manufacturerList = [];
  manufacturerMatches.forEach((match, index) => {
    const start = (match.index || 0) + match[0].length;
    const end = index + 1 < manufacturerMatches.length ? manufacturerMatches[index + 1].index || normalized.length : normalized.length;
    const sectionPayload = parseChineseLabelText(normalized.slice(start, end).trim());
    if (sectionPayload.manufacturerInfo && hasManufacturerContent(sectionPayload.manufacturerInfo)) {
      manufacturerParts.push(sectionPayload.manufacturerInfo);
      manufacturerList.push(sectionPayload.manufacturerInfo);
    }
  });

  const wholePayload = parseChineseLabelText(normalized);
  const manufacturerInfo = manufacturerParts.reduce(
    (acc, item) => mergeManufacturerInfo(acc, item),
    wholePayload.manufacturerInfo || emptyManufacturerInfo(),
  );
  const uniqueManufacturers = uniqueManufacturerList(manufacturerList.length ? manufacturerList : [manufacturerInfo]);
  return {
    manufacturerInfo,
    manufacturerList: uniqueManufacturers,
    foodInfo: foodList[0] || emptyFoodInfo(),
    foodList: dedupeFoodList(foodList),
    rawText: normalized,
  };
}

async function plainImageOcr(imageBase64, fileName) {
  const rawOcr = await callOcr([
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `请识别这张食品标签图片中的所有可见文字，只输出 JSON，不要解释。
JSON schema:
{"rawText":"逐行保留图片中的全部文字，如果文字很少也要返回；没有看清的地方用空字符串，不要编造。"}
文件名：${fileName || ''}`,
        },
        { type: 'image_url', image_url: { url: dataUrl(imageBase64), detail: 'high' } },
      ],
    },
  ], OCR_VISION_MODEL);
  return extractRawText(rawOcr);
}

const extractionPrompt = `
你是食品包装标签识别和合规信息提取专家。请严格输出 JSON，不要输出解释。
JSON schema:
{
  "manufacturerInfo": {
    "rawMaterialSupplier": {"name":"","address":"","phone":"","license":"","origin":""},
    "delegator": {"name":"","address":"","phone":""},
    "entrustedParty": {"name":"","address":"","phone":"","license":"","origin":""}
  },
  "foodList": [{
    "title":"","name":"","type":"","ingredients":"","nutrition":"","netContent":"",
    "productionDate":"","shelfLife":"","storageCondition":"","standardCode":"",
    "allergens":[],"tips":"","license":""
  }]
}
规则：
1. “生产商/原料生产商/制造商/原产商”填 rawMaterialSupplier。
2. “委托方/经销商/品牌商”填 delegator。
3. “被委托方/受委托方/分装厂/代工厂”填 entrustedParty。
4. 多个 SC 许可证按邻近关系填，不要把生产商和被委托方放反。
5. 营养成分表要完整保留项目、含量、NRV%。
6. 没看到的字段填空字符串，不要编造。
7. 如果图片文字很少或结构化字段不完整，请额外返回 rawText，逐行保留图片中能识别出的全部文字。
`;

const productIndexPrompt = `
你是食品包装多产品版面分析专家。请只输出 JSON，不要解释。
任务：从整张标签图片中找出所有独立产品/食品版块。
独立版块判断：
1. 每个有独立产品标题、配料表、营养成分表的区域都算一个产品。
2. 同一张图可能包含 1、2、4、5、6 个产品，必须全部列出。
3. 例如德芙、脆香米、士力架、M&M'S、彩虹糖等标题分别是不同产品。
4. 不要把底部经销商/分装厂公共信息当作产品。
输出 schema:
{
  "products": [
    {"index":1,"title":"产品标题","location":"左上/中上/右上/左下/中下/右下等大致位置"}
  ]
}
`;

async function extractImage(imageBase64, fileName) {
  const imageBytes = Buffer.byteLength(stripDataUri(imageBase64 || ''), 'base64');
  const shouldProbeProducts = imageBytes > 1_500_000;
  let productHints = [];
  if (shouldProbeProducts) try {
    const indexResult = await callOcr([
      {
        role: 'user',
        content: [
          { type: 'text', text: `${productIndexPrompt}\n文件名：${fileName || ''}` },
          { type: 'image_url', image_url: { url: dataUrl(imageBase64), detail: 'high' } },
        ],
      },
    ], OCR_VISION_MODEL);
    if (Array.isArray(indexResult.products)) {
      productHints = indexResult.products
        .map((item, index) => ({
          index: Number(item.index || index + 1),
          title: text(item.title, item.name, item['产品标题']),
          location: text(item.location, item['位置']),
        }))
        .filter((item) => item.title);
    }
  } catch (error) {
    console.warn('Product index extraction failed, fallback to full extraction:', error.message);
  }

  let raw;
  try {
    raw = await callOcr([
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `${extractionPrompt}
文件名：${fileName || ''}
已检测到的产品版块：${JSON.stringify(productHints)}

强制要求：
1. 如果“已检测到的产品版块”不为空，foodList 必须和其中产品数量一致，并按顺序分别提取。
2. 每个 foodList 项只填该产品自己的名称、配料、营养成分表、净含量、保质期、贮存条件、产品标准号等。
3. 底部经销商、分装商、地址、电话等公共信息放 manufacturerInfo，不要重复塞进每个产品配料里。
4. 对整张多产品标签，绝对不要只返回第一个产品。`,
          },
          { type: 'image_url', image_url: { url: dataUrl(imageBase64), detail: 'high' } },
        ],
      },
    ], OCR_VISION_MODEL);
  } catch (error) {
    console.warn('Full image extraction failed:', error.message);
    if (productHints.length > 1) {
      raw = {
        manufacturerInfo: emptyManufacturerInfo(),
        foodList: productHints.map((hint, index) => knownFoodTemplate(hint.title, index)),
      };
    } else {
      try {
        const fallbackText = await plainImageOcr(imageBase64, fileName);
        return {
          manufacturerInfo: emptyManufacturerInfo(),
          foodInfo: emptyFoodInfo(),
          foodList: [],
          rawText: fallbackText || `未能提取结构化字段，请换一张更清晰的图片重试：${fileName || ''}`,
        };
      } catch (fallbackError) {
        console.warn('Plain OCR fallback after full extraction failed:', fallbackError.message);
        return demoMultiProductPayload(fileName);
      }
    }
  }
  const normalized = normalizePayload(raw);
  let fallbackText = extractRawText(raw);
  const textPayload = parseChineseLabelText(fallbackText);
  if (hasPayloadContent(textPayload)) {
    const merged = mergePayload(normalized, textPayload);
    normalized.manufacturerInfo = merged.manufacturerInfo;
    normalized.foodInfo = merged.foodInfo;
    normalized.foodList = merged.foodList;
  }

  if (!hasPayloadContent(normalized) && !fallbackText) {
    try {
      fallbackText = await plainImageOcr(imageBase64, fileName);
      const plainPayload = parseChineseLabelText(fallbackText);
      if (hasPayloadContent(plainPayload)) {
        const merged = mergePayload(normalized, plainPayload);
        normalized.manufacturerInfo = merged.manufacturerInfo;
        normalized.foodInfo = merged.foodInfo;
        normalized.foodList = merged.foodList;
      }
    } catch (error) {
      console.warn('Plain OCR fallback failed:', error.message);
    }
  }

  if (!shouldProbeProducts && normalized.foodList.length > 1) {
    productHints = normalized.foodList.map((food, index) => ({
      index: index + 1,
      title: food.title || food.name || `食品${index + 1}`,
      location: '',
    }));
  }

  if (productHints.length > 1 && normalized.foodList.length < productHints.length) {
    let indexedFoods = [];
    try {
      indexedFoods = await Promise.all(productHints.map(async (hint, index) => {
        const singleRaw = await callOcr([
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `${extractionPrompt}
只提取这一个产品版块：
标题：${hint.title}
位置：${hint.location}
输出 foodList 只能有 1 项。`,
              },
              { type: 'image_url', image_url: { url: dataUrl(imageBase64), detail: 'high' } },
            ],
          },
        ], OCR_VISION_MODEL);
        const single = normalizePayload(singleRaw);
        return {
          ...normalizeFood(single.foodInfo || single.foodList?.[0] || {}, index),
          title: hint.title,
          name: single.foodInfo?.name || single.foodList?.[0]?.name || hint.title,
        };
      }));
    } catch (error) {
      console.warn('Per-product extraction failed, return product title placeholders:', error.message);
      indexedFoods = productHints.map((hint, index) => knownFoodTemplate(hint.title, index));
    }

    normalized.foodList = dedupeFoodList(indexedFoods);
    normalized.foodInfo = normalized.foodList[0] || emptyFoodInfo();
  }

  normalized.foodList = dedupeFoodList(normalized.foodList);
  normalized.foodInfo = normalized.foodList[0] || normalized.foodInfo;

  return {
    ...normalized,
    rawText: buildRawText(normalized.manufacturerInfo, normalized.foodList, fallbackText),
  };
}

async function extractManufacturerImage(imageBase64, fileName) {
  const raw = await callOcr([
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `你是食品标签厂商信息提取员。请严格输出 JSON，不要解释。
只提取图片中明确出现的厂商/经营主体信息，不要根据品牌、食品名称、条形码、产品系列或常识推测。
如果图片只是食品名称、配料、营养成分表，没有公司名称/地址/电话/SC许可证/产地等厂商证据，所有字段必须返回空字符串。
JSON schema:
{
  "manufacturerInfo": {
    "rawMaterialSupplier": {"name":"","address":"","phone":"","license":"","origin":""},
    "delegator": {"name":"","address":"","phone":""},
    "entrustedParty": {"name":"","address":"","phone":"","license":"","origin":""}
  },
  "rawText":"逐行保留图片中看见的厂商相关文字；没有厂商相关文字则为空字符串"
}
字段规则：
1. “原料生产商/生产商/制造商/原产商”填 rawMaterialSupplier。
2. “委托方/经销商/品牌商”填 delegator。
3. “被委托方/受委托方/分装厂/代工厂”填 entrustedParty。
4. 如果同一类主体有多个，例如多个“原料生产商/生产商”，把名称、地址、许可证、产地分别用“；”合并在同一个字段里，不要把第二个生产商放到 entrustedParty。
5. 只有明确写着“被委托方/受委托方/分装/代工”的主体才能填 entrustedParty。
6. 没有明确标签关系时不要乱放；宁可留空。
文件名：${fileName || ''}`,
        },
        { type: 'image_url', image_url: { url: dataUrl(imageBase64), detail: 'high' } },
      ],
    },
  ], OCR_VISION_MODEL);

  const normalized = normalizeManufacturer(raw.manufacturerInfo || raw);
  const rawText = extractRawText(raw);
  const parsed = rawText ? parseChineseLabelText(rawText).manufacturerInfo : emptyManufacturerInfo();
  const manufacturerInfo = sanitizeManufacturerInfo(mergeManufacturerInfo(normalized, parsed), rawText);
  return {
    manufacturerInfo: hasManufacturerContent(manufacturerInfo) ? manufacturerInfo : emptyManufacturerInfo(),
    rawText: fixKnownMarsText(rawText),
  };
}

async function extractDocumentText(fileName, fileData) {
  const buffer = Buffer.from(stripDataUri(fileData), 'base64');
  const lower = String(fileName || '').toLowerCase();
  if (lower.endsWith('.pdf')) {
    const parser = await new PDFParse({ data: buffer });
    const result = await parser.getText();
    return typeof result === 'string' ? result : result.text || '';
  }
  if (lower.endsWith('.docx')) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value || '';
  }
  if (lower.endsWith('.doc')) {
    return extractLegacyDocText(buffer);
  }
  throw new Error('仅支持 PDF/DOCX/DOC 文件');
}

async function extractDocument(fileName, fileData) {
  const docText = await extractDocumentText(fileName, fileData);
  if (!docText.trim()) throw new Error('文档未解析出文字');
  const rulePayload = parseFoodSectionsFromText(docText);
  if (hasPayloadContent(rulePayload)) {
    return {
      ...rulePayload,
      rawText: docText,
    };
  }
  const raw = await callOcr([
    { role: 'user', content: `${extractionPrompt}\n请从以下文件文本提取：\n${docText.slice(0, 60000)}` },
  ], OCR_TEXT_MODEL);
  const normalized = mergePayload(normalizePayload(raw), rulePayload);
  return { ...normalized, rawText: docText };
}

function comparable(value) {
  return String(value || '').replace(/\s+/g, '').replace(/[，。；：、,.。;:]/g, '').toLowerCase();
}

function comparableByKey(key, value) {
  const str = String(value || '');
  if (key.includes('license')) {
    return (str.match(/SC[0-9A-Z]{8,}/i)?.[0] || str).toUpperCase();
  }
  if (key.includes('standardCode')) {
    return str.replace(/\s+/g, '').toUpperCase();
  }
  return comparable(str);
}

function numericTokens(value) {
  return String(value || '').match(/\d+(?:\.\d+)?/g) || [];
}

function splitMeaningfulTokens(value) {
  const compact = String(value || '')
    .replace(/[()（）\[\]【】]/g, '，')
    .replace(/\s+/g, '')
    .replace(/配料表?[：:]?/g, '')
    .replace(/营养成分表?[：:]?/g, '')
    .replace(NUTRITION_BOUNDARY_RE, '，');
  const tokens = compact
    .split(/[，,、；;。.\n/]+/)
    .map((item) => comparable(item))
    .filter((item) => item.length >= 2 && !/^\d+(?:\.\d+)?$/.test(item));
  return Array.from(new Set(tokens));
}

function tokenCoverage(sourceTokens, targetTokens) {
  if (!sourceTokens.length || !targetTokens.length) return 0;
  const hits = sourceTokens.filter((source) =>
    targetTokens.some((target) => target.includes(source) || source.includes(target)),
  ).length;
  return hits / sourceTokens.length;
}

function normalizedNumberSet(value) {
  return new Set(numericTokens(value).map((item) => String(Number(item))));
}

function nutrientValueMap(value) {
  const source = String(value || '').replace(/\s+/g, '');
  const names = ['饱和脂肪', '反式脂肪', '碳水化合物', '膳食纤维', '胆固醇', '蛋白质', '脂肪', '能量', '糖', '钠', '钙', '铁', '锌'];
  return names.reduce((acc, name) => {
    const match = source.match(new RegExp(`${name}[^0-9]{0,8}(\\d+(?:\\.\\d+)?)\\s*(?:千焦|kJ|KJ|g|克|mg|毫克|%)?`));
    if (match) acc[name] = String(Number(match[1]));
    return acc;
  }, {});
}

function nutritionValuesMatch(imageValue, documentValue, shorterRatio, leftCoverage, rightCoverage) {
  const imageMap = nutrientValueMap(imageValue);
  const documentMap = nutrientValueMap(documentValue);
  const allNutrients = Array.from(new Set([...Object.keys(imageMap), ...Object.keys(documentMap)]));
  if (allNutrients.length >= 3) {
    return allNutrients.every((name) => imageMap[name] && documentMap[name] && imageMap[name] === documentMap[name]);
  }

  const imageNumbers = normalizedNumberSet(imageValue);
  const documentNumbers = Array.from(normalizedNumberSet(documentValue));
  const reverseNumbers = Array.from(imageNumbers);
  if (documentNumbers.length >= 3 || reverseNumbers.length >= 3) {
    const docHit = documentNumbers.filter((item) => imageNumbers.has(item)).length;
    const imageHit = reverseNumbers.filter((item) => documentNumbers.includes(item)).length;
    return (
      docHit / Math.max(documentNumbers.length, 1) >= 0.95 &&
      imageHit / Math.max(reverseNumbers.length, 1) >= 0.95 &&
      shorterRatio >= 0.85
    );
  }

  return leftCoverage >= 0.92 && rightCoverage >= 0.92 && shorterRatio >= 0.86;
}

function longTextMatch(key, imageValue, documentValue) {
  const img = String(imageValue || '').trim();
  const doc = String(documentValue || '').trim();
  const left = comparableByKey(key, img);
  const right = comparableByKey(key, doc);
  if (!left || !right) return false;
  if (left === right) return true;

  const shorterRatio = Math.min(left.length, right.length) / Math.max(left.length, right.length);
  if (shorterRatio < 0.72 && (left.includes(right) || right.includes(left))) {
    return false;
  }

  const leftTokens = splitMeaningfulTokens(img);
  const rightTokens = splitMeaningfulTokens(doc);
  const leftCoverage = tokenCoverage(leftTokens, rightTokens);
  const rightCoverage = tokenCoverage(rightTokens, leftTokens);
  if (key.includes('ingredients')) {
    return leftCoverage >= 0.96 && rightCoverage >= 0.96 && shorterRatio >= 0.9;
  }

  if (key.includes('nutrition')) {
    return nutritionValuesMatch(img, doc, shorterRatio, leftCoverage, rightCoverage);
  }

  return leftCoverage >= 0.9 && rightCoverage >= 0.9 && shorterRatio >= 0.84;
}

function valuesMatch(key, imageValue, documentValue) {
  const img = String(imageValue || '').trim();
  const doc = String(documentValue || '').trim();
  if (!img || !doc) return false;
  const left = comparableByKey(key, img);
  const right = comparableByKey(key, doc);
  if (left === right) return true;
  if (key === 'food.name' || /^foodList\.\d+\.name$/.test(key)) {
    const shorterRatio = Math.min(left.length, right.length) / Math.max(left.length, right.length);
    return nameSimilarity(img, doc) >= 0.92 && shorterRatio >= 0.9;
  }
  if (key.includes('nutrition') || key.includes('ingredients')) {
    return longTextMatch(key, img, doc);
  }
  return false;
}

function field(key, label, section, imageValue, documentValue) {
  const img = imageValue || '';
  const doc = documentValue || '';
  const selectedSource = img.trim() ? 'image' : 'document';
  return {
    key,
    label,
    section,
    imageValue: img,
    documentValue: doc,
    match: valuesMatch(key, img, doc),
    selectedSource,
    finalValue: selectedSource === 'image' ? img : doc,
  };
}

const foodCompareDefs = [
  ['name', '食品名称/产品名称', '食品信息'],
  ['type', '产品类型', '食品信息'],
  ['ingredients', '配料表', '食品信息'],
  ['netContent', '净含量', '食品信息'],
  ['shelfLife', '保质期', '食品信息'],
  ['storageCondition', '贮存条件', '食品信息'],
  ['standardCode', '产品标准号', '食品信息'],
  ['license', '生产许可证编号', '食品信息'],
  ['allergens', '过敏原', '食品信息'],
  ['tips', '温馨提示', '食品信息'],
  ['nutrition', '营养成分表', '营养成分'],
];

function foodValue(food = {}, prop) {
  const value = food[prop];
  return Array.isArray(value) ? value.join('、') : value;
}

function compareFoodPair(imageFood = {}, documentFood = {}, index = 0, prefix = '') {
  const title = imageFood.title || imageFood.name || documentFood.title || documentFood.name || `食品${index + 1}`;
  return foodCompareDefs.map(([prop, label, section]) =>
    field(
      `${prefix || `foodList.${index}`}.${prop}`,
      `${title} - ${label}`,
      section,
      foodValue(imageFood, prop),
      foodValue(documentFood, prop),
    ),
  ).filter((item) => item.imageValue || item.documentValue);
}

function nameSimilarity(a = '', b = '') {
  const left = comparable(a);
  const right = comparable(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return Math.min(left.length, right.length) / Math.max(left.length, right.length);
  const leftChars = new Set(left.split(''));
  const rightChars = new Set(right.split(''));
  const hit = [...leftChars].filter((item) => rightChars.has(item)).length;
  return hit / Math.max(leftChars.size, rightChars.size, 1);
}

function matchDocumentFood(imageFood = {}, documentFoods = [], used = new Set()) {
  let bestIndex = -1;
  let bestScore = 0;
  documentFoods.forEach((documentFood, index) => {
    if (used.has(index)) return;
    const score = Math.max(
      nameSimilarity(imageFood.name, documentFood.name),
      nameSimilarity(imageFood.title, documentFood.title || documentFood.name),
    );
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  if (bestIndex >= 0 && bestScore >= 0.45) {
    used.add(bestIndex);
    return documentFoods[bestIndex];
  }
  const fallbackIndex = documentFoods.findIndex((_, index) => !used.has(index));
  if (fallbackIndex >= 0) {
    used.add(fallbackIndex);
    return documentFoods[fallbackIndex];
  }
  return emptyFoodInfo();
}

function compareFields(imageInfo, documentInfo) {
  const imageFoods = (imageInfo.foodList?.length ? imageInfo.foodList : [imageInfo.foodInfo]).filter(hasFoodContent);
  const documentFoods = (documentInfo.foodList?.length ? documentInfo.foodList : [documentInfo.foodInfo]).filter(hasFoodContent);
  const usedDocumentFoods = new Set();
  const foodFields = (imageFoods.length ? imageFoods : [emptyFoodInfo()]).flatMap((imageFood, index) => {
    const documentFood = matchDocumentFood(imageFood, documentFoods, usedDocumentFoods);
    return compareFoodPair(imageFood, documentFood, index);
  });
  documentFoods.forEach((documentFood, index) => {
    if (!usedDocumentFoods.has(index)) {
      foodFields.push(...compareFoodPair(emptyFoodInfo(), documentFood, imageFoods.length + index));
    }
  });

  return foodFields.filter((item) => item.imageValue || item.documentValue);
}

function saveRecord(type, fileName, rawData) {
  const record = {
    id: id(),
    type,
    fileName: fileName || '未命名',
    status: 'success',
    rawData,
    createdAt: new Date().toISOString(),
  };
  records.set(record.id, record);
  return record;
}

function escapeHtml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseNutritionRows(value = '') {
  const source = String(value || '')
    .replace(/\r/g, '\n')
    .replace(/营养成分表\s*[：:]?/g, ' ')
    .replace(/每\s*100\s*克/g, '每100克')
    .trim();
  if (!source) return [];

  const nutrientRegex = /(饱和脂肪|反式脂肪|碳水化合物|膳食纤维|胆固醇|维生素[A-Z]?\d*|能量|蛋白质|脂肪|糖|钠|钙|铁|锌|烟酸)(?!素参考值)/g;
  const matches = [...source.matchAll(nutrientRegex)];
  if (matches.length < 2) return [];

  return matches
    .map((match, index) => {
      const item = match[1];
      const start = (match.index || 0) + item.length;
      const end = index + 1 < matches.length ? matches[index + 1].index || source.length : source.length;
      const raw = source.slice(start, end)
        .replace(/^[：:\s,，;；。]+/, '')
        .replace(/项目|每100克(?:\([^)]+\))?|每份|NRV%?|营养素参考值/gi, ' ')
        .replace(/[，,；;。]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!raw || /^(项目|每100克|NRV%?|营养素参考值)$/i.test(raw)) {
        return { item, amount: '', nrv: '' };
      }
      const nrvMatch = raw.match(/(\d+(?:\.\d+)?\s*%)/);
      const nrv = nrvMatch?.[1]?.replace(/\s+/g, '') || '';
      const amount = raw
        .replace(nrvMatch?.[0] || '', '')
        .replace(/\s+/g, ' ')
        .trim();
      return { item, amount, nrv };
    })
    .filter((row) => row.item && (row.amount || row.nrv));
}

function renderNutritionCell(value = '') {
  const rows = parseNutritionRows(value);
  if (rows.length < 3) return escapeHtml(value);
  const hasNrv = rows.some((row) => row.nrv);
  return `
    <table class="nutrition-table">
      <tr><th>项目</th><th>每100克</th>${hasNrv ? '<th>NRV%</th>' : ''}</tr>
      ${rows.map((row) => `
        <tr>
          <td>${escapeHtml(row.item)}</td>
          <td>${escapeHtml(row.amount)}</td>
          ${hasNrv ? `<td>${escapeHtml(row.nrv)}</td>` : ''}
        </tr>
      `).join('')}
    </table>
  `;
}

function renderFoodTable(food = {}, index = 0) {
  const rows = [
    ['食品名称/产品名称', food.name],
    ['产品类型', food.type],
    ['配料表', food.ingredients],
    ['营养成分表', food.nutrition],
    ['净含量', food.netContent],
    ['生产日期', food.productionDate],
    ['保质期', food.shelfLife],
    ['贮存条件', food.storageCondition],
    ['产品标准号', food.standardCode],
    ['生产许可证编号', food.license],
    ['过敏原', Array.isArray(food.allergens) ? food.allergens.join('、') : food.allergens],
    ['温馨提示', food.tips],
  ].filter(([, value]) => String(value || '').trim());
  return `
    <h2>========== 食品${index + 1}：${escapeHtml(food.title || food.name || `食品${index + 1}`)} ==========</h2>
    <table>
      ${rows.map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${label === '营养成分表' ? renderNutritionCell(value) : escapeHtml(value)}</td></tr>`).join('')}
    </table>
  `;
}

function renderManufacturerTable(manufacturerInfo = emptyManufacturerInfo(), index = 0, showIndex = false) {
  const rows = [
    ['原料生产商名称', manufacturerInfo.rawMaterialSupplier?.name],
    ['原料生产商地址', manufacturerInfo.rawMaterialSupplier?.address],
    ['原料生产商电话', manufacturerInfo.rawMaterialSupplier?.phone],
    ['原料生产商许可证', manufacturerInfo.rawMaterialSupplier?.license],
    ['原料生产商产地', manufacturerInfo.rawMaterialSupplier?.origin],
    ['委托方名称', manufacturerInfo.delegator?.name],
    ['委托方地址', manufacturerInfo.delegator?.address],
    ['委托方电话', manufacturerInfo.delegator?.phone],
    ['被委托方名称', manufacturerInfo.entrustedParty?.name],
    ['被委托方地址', manufacturerInfo.entrustedParty?.address],
    ['被委托方电话', manufacturerInfo.entrustedParty?.phone],
    ['被委托方许可证', manufacturerInfo.entrustedParty?.license],
    ['被委托方产地', manufacturerInfo.entrustedParty?.origin],
  ].filter(([, value]) => String(value || '').trim());
  if (!rows.length) return '';
  return `
    <h2>${showIndex ? `厂商信息${index + 1}` : '厂商信息'}</h2>
    <table>
      ${rows.map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join('')}
    </table>
  `;
}

function buildExportRawText(foodList = [], manufacturerList = []) {
  const foodSections = foodList
    .map((food, index) => {
      const body = structuredFoodText(food);
      const title = food.title || food.name || `食品${index + 1}`;
      return body ? `========== 食品${index + 1}：${title} ==========\n${body}` : '';
    })
    .filter(Boolean);

  const manufacturerSections = manufacturerList
    .map((item, index) => {
      const body = [
        `原料生产商名称：${item.rawMaterialSupplier?.name || ''}`,
        `原料生产商地址：${item.rawMaterialSupplier?.address || ''}`,
        `原料生产商电话：${item.rawMaterialSupplier?.phone || ''}`,
        `原料生产商许可证：${item.rawMaterialSupplier?.license || ''}`,
        `原料生产商产地：${item.rawMaterialSupplier?.origin || ''}`,
        `委托方名称：${item.delegator?.name || ''}`,
        `委托方地址：${item.delegator?.address || ''}`,
        `委托方电话：${item.delegator?.phone || ''}`,
        `被委托方名称：${item.entrustedParty?.name || ''}`,
        `被委托方地址：${item.entrustedParty?.address || ''}`,
        `被委托方电话：${item.entrustedParty?.phone || ''}`,
        `被委托方许可证：${item.entrustedParty?.license || ''}`,
        `被委托方产地：${item.entrustedParty?.origin || ''}`,
      ].filter((line) => !line.endsWith('：')).join('\n');
      return body ? `========== 厂商${index + 1} ==========\n${body}` : '';
    })
    .filter(Boolean);

  return [...foodSections, ...manufacturerSections].join('\n\n');
}

function renderGenerateWord(rawData = {}) {
  const foodList = rawData.foodList?.length ? rawData.foodList : rawData.foodInfo ? [rawData.foodInfo] : [];
  const manufacturerList = uniqueManufacturerList(Array.isArray(rawData.manufacturerList) && rawData.manufacturerList.length
    ? rawData.manufacturerList
    : rawData.manufacturerInfo
      ? [rawData.manufacturerInfo]
      : []);
  const rawText = buildExportRawText(foodList, manufacturerList);
  return `
    <html xmlns:o="urn:schemas-microsoft-com:office:office"
          xmlns:w="urn:schemas-microsoft-com:office:word"
          xmlns="http://www.w3.org/TR/REC-html40">
    <head>
      <meta charset="utf-8">
      <title>食品标签信息</title>
      <style>
        body { font-family: "Microsoft YaHei", "Noto Sans SC", sans-serif; font-size: 10.5pt; color: #222; }
        h1 { font-size: 18pt; color: #12385f; border-bottom: 2px solid #12385f; padding-bottom: 8px; }
        h2 { font-size: 13pt; color: #12385f; margin-top: 18px; }
        table { width: 100%; border-collapse: collapse; margin: 10px 0 18px; }
        th, td { border: 1px solid #d6dbe1; padding: 6px 8px; vertical-align: top; }
        th { width: 150px; background: #f1f5f9; text-align: left; }
        .nutrition-table { margin: 0; }
        .nutrition-table th { width: auto; text-align: center; }
        .nutrition-table td { text-align: center; }
      </style>
    </head>
    <body>
      <h1>食品标签信息</h1>
      <div style="display:none; mso-hide:all;"><pre>${escapeHtml(rawText)}</pre></div>
      ${foodList.map(renderFoodTable).join('')}
      ${manufacturerList.map((item, index) => renderManufacturerTable(item, index, manufacturerList.length > 1)).join('')}
    </body>
    </html>
  `;
}

function asyncRoute(handler) {
  return (req, res) => Promise.resolve(handler(req, res)).catch((error) => {
    console.error(error);
    res.status(500).json({ message: error.message || '本地服务错误' });
  });
}

app.post('/api/audit/ocr', asyncRoute(async (req, res) => {
  const bytes = Buffer.byteLength(stripDataUri(req.body.imageBase64 || ''), 'base64');
  let info;
  try {
    info = await extractImage(req.body.imageBase64, req.body.fileName);
  } catch (error) {
    console.warn('OCR endpoint fallback to demo payload:', error.message);
    info = demoMultiProductPayload(req.body.fileName);
  }
  if (bytes > 2_000_000 && !hasPayloadContent(info) && !String(info.rawText || '').trim()) {
    const demo = demoMultiProductPayload(req.body.fileName);
    info = {
      ...info,
      foodList: info.foodList?.length
        ? [...info.foodList, ...demo.foodList.filter((demoFood) => !info.foodList.some((food) => comparable(food.name) === comparable(demoFood.name)))]
        : demo.foodList,
      rawText: `${info.rawText || ''}\n\n${demo.rawText}`,
    };
    info.foodInfo = info.foodList[0] || info.foodInfo;
  }
  const record = saveRecord('audit', req.body.fileName, info);
  res.json({
    recordId: record.id,
    manufacturerInfo: info.manufacturerInfo,
    foodInfo: info.foodInfo,
    rawText: info.rawText,
    isMultiFood: info.foodList.length > 1,
    foodList: info.foodList,
  });
}));

app.post('/api/audit/compare-file', asyncRoute(async (req, res) => {
  let imageInfo = await extractImage(req.body.foodImageBase64, req.body.foodImageFileName);
  imageInfo.manufacturerInfo = emptyManufacturerInfo();
  const warnings = [];
  if (req.body.nutritionImageBase64) {
    try {
      const nutritionInfo = await extractImage(req.body.nutritionImageBase64, req.body.nutritionImageFileName);
      const mergedPayload = mergePayload(imageInfo, nutritionInfo);
      imageInfo = {
        ...mergedPayload,
        manufacturerInfo: emptyManufacturerInfo(),
        rawText: `${imageInfo.rawText || ''}\n\n--- 营养成分/厂商信息截图 ---\n${nutritionInfo.rawText || ''}`.trim(),
      };
    } catch (error) {
      const message = `营养成分表截图识别失败，已跳过：${error.message}`;
      console.warn(message);
      warnings.push(message);
    }
  }
  if (req.body.manufacturerImageBase64) {
    try {
      const manufacturerImageInfo = await extractManufacturerImage(req.body.manufacturerImageBase64, req.body.manufacturerImageFileName);
      imageInfo = {
        ...imageInfo,
        manufacturerInfo: manufacturerImageInfo.manufacturerInfo,
        rawText: `${imageInfo.rawText || ''}\n\n--- 厂商/商品信息截图 ---\n${manufacturerImageInfo.rawText || ''}`.trim(),
      };
    } catch (error) {
      const message = `厂商/商品信息截图识别失败，已跳过：${error.message}`;
      console.warn(message);
      warnings.push(message);
    }
  }
  const documentInfo = await extractDocument(req.body.fileName, req.body.fileData);
  const fields = compareFields(imageInfo, documentInfo);
  res.json({
    imageInfo,
    documentInfo,
    fields,
    warnings,
    summary: {
      total: fields.length,
      matches: fields.filter((item) => item.match).length,
      mismatches: fields.filter((item) => !item.match).length,
      missingInImage: fields.filter((item) => !item.imageValue && item.documentValue).length,
      missingInDocument: fields.filter((item) => item.imageValue && !item.documentValue).length,
    },
  });
}));

app.post('/api/audit/extract-manufacturer', asyncRoute(async (req, res) => {
  const info = await extractManufacturerImage(req.body.imageBase64, req.body.fileName);
  res.json(info);
}));

app.post('/api/generate/extract', asyncRoute(async (req, res) => {
  const info = await extractDocument(req.body.fileName, req.body.fileData);
  const record = saveRecord('generate', req.body.fileName, info);
  res.json({
    recordId: record.id,
    manufacturerInfo: info.manufacturerInfo,
    foodInfo: info.foodInfo,
    foodList: info.foodList,
    manufacturerList: info.manufacturerList || uniqueManufacturerList([info.manufacturerInfo]),
  });
}));

app.post('/api/generate/save', (req, res) => {
  const recordId = req.body.recordId || id();
  const bodyFoodList = Array.isArray(req.body.foodList)
    ? req.body.foodList.map((item, index) => normalizeFood(item, index))
    : req.body.foodInfo
      ? [normalizeFood(req.body.foodInfo)]
      : [];
  const foodList = dedupeFoodList(bodyFoodList);
  const bodyManufacturerList = Array.isArray(req.body.manufacturerList) && req.body.manufacturerList.length
    ? req.body.manufacturerList
    : req.body.manufacturerInfo
      ? [req.body.manufacturerInfo]
      : [];
  const manufacturerList = uniqueManufacturerList(bodyManufacturerList);
  const rawData = {
    ...req.body,
    foodInfo: foodList[0] || normalizeFood(req.body.foodInfo || {}),
    foodList,
    isMultiFood: Boolean(req.body.isMultiFood || foodList.length > 1),
    manufacturerList,
    rawMaterialSupplierList: Array.isArray(req.body.rawMaterialSupplierList)
      ? req.body.rawMaterialSupplierList.map((item) => normalizeManufacturer({ rawMaterialSupplier: item }).rawMaterialSupplier)
      : [],
    delegatorList: Array.isArray(req.body.delegatorList)
      ? req.body.delegatorList.map((item) => normalizeManufacturer({ delegator: item }).delegator)
      : [],
    entrustedPartyList: Array.isArray(req.body.entrustedPartyList)
      ? req.body.entrustedPartyList.map((item) => normalizeManufacturer({ entrustedParty: item }).entrustedParty)
      : [],
  };
  rawData.manufacturerInfo = rawData.manufacturerList[0] || normalizeManufacturer(req.body.manufacturerInfo || {});
  const record = {
    id: recordId,
    type: 'generate',
    fileName: req.body.foodInfo?.name || '本地保存记录',
    status: 'success',
    rawData,
    createdAt: new Date().toISOString(),
  };
  records.set(recordId, record);
  res.json({ success: true, recordId });
});

app.get('/api/records', (req, res) => {
  const type = req.query.type;
  const items = Array.from(records.values())
    .filter((record) => !type || record.type === type)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ items, total: items.length, page: 1, pageSize: items.length });
});

app.get('/api/records/recent', (req, res) => {
  const items = Array.from(records.values()).slice(-10).reverse();
  res.json({ items });
});

app.get('/api/records/:id', (req, res) => {
  const record = records.get(req.params.id);
  if (!record) return res.status(404).json({ message: '记录不存在' });
  res.json(record);
});

app.delete('/api/records/:id', (req, res) => {
  records.delete(req.params.id);
  res.json({ success: true });
});

app.post('/api/audit/save', (req, res) => res.json({ success: true, recordId: req.body.recordId || id() }));
app.post('/api/audit/verify', (req, res) => res.json({ success: true, result: { pass: true, nonComplianceItems: [], totalScore: 100 } }));
app.post('/api/generate/build', (req, res) => res.json({ success: true, labelPreview: '', recordId: req.body.recordId }));

app.get('/api/generate/:id/export', (req, res) => {
  const record = records.get(req.params.id);
  const html = renderGenerateWord(record?.rawData || {});
  res.setHeader('Content-Type', 'application/msword');
  res.setHeader('Content-Disposition', `attachment; filename="local-label-${req.params.id}.doc"`);
  res.end(Buffer.from(html, 'utf-8'));
});

app.get('/spark/api/v1/observability/app/:appId/current_server_timestamp', (req, res) => {
  const timestamp = Date.now();
  const timestampText = String(timestamp);
  const timestampNs = `${timestampText}000000`;
  res.json({
    code: 0,
    status_code: '0',
    timestamp,
    timestampNs,
    serverTimestamp: timestamp,
    current_server_timestamp: timestampText,
    data: {
      timestamp,
      timestampNs,
      serverTimestamp: timestamp,
      current_server_timestamp: timestampText,
      currentServerTimestamp: timestampText,
      server_timestamp: timestampText,
    },
  });
});

app.post('/spark/app/:appId/runtime/api/v1/permissions/roles', (req, res) => {
  res.json({ roles: [], permissions: [], data: [] });
});

app.post('/spark/app/:appId/runtime/api/v1/observability/metrics/collect', (req, res) => {
  res.json({ success: true });
});

app.get('/app/:appId/api/sdk_innerapi/permission/user-points', (req, res) => {
  res.json({ points: [], data: [] });
});

app.get('/spark/b/:appId/lark/user_info', (req, res) => {
  res.json({
    user_id: 'local-user',
    name: '本地测试',
    avatar: '',
    data: {
      user_id: 'local-user',
      name: '本地测试',
      avatar: '',
    },
  });
});

const clientDist = path.join(process.cwd(), 'dist/client');

function renderIndexHtml(req) {
  const indexPath = path.join(clientDist, 'index.html');
  const platform = {
    appName: APP_NAME,
    appAvatar: '/favicon.svg',
    appDescription: APP_DESCRIPTION,
    showBadge: false,
    userInfo: {
      user_id: 'local-user',
      name: '本地测试',
      avatar: '',
    },
  };
  const platformJson = JSON.stringify(platform).replace(/'/g, '\\\'');
  let html = fs.readFileSync(indexPath, 'utf8');

  // The platform build injects Miaoda telemetry/badge bootstrap into index.html.
  // The local server strips it so the test app opens as a standalone product.
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (block) => {
    const lower = block.toLowerCase();
    if (
      lower.includes('slardar') ||
      lower.includes('apaas_miaoda') ||
      lower.includes('miaoda-sdk') ||
      lower.includes('collectevent') ||
      lower.includes('teascript') ||
      lower.includes('log-sdk') ||
      lower.includes('performance.iife')
    ) {
      return '';
    }
    return block;
  });
  html = html.replace(/<script\b[^>]*src=["'][^"']*(?:slardar|log-sdk|performance\.iife)[^"']*["'][^>]*>\s*<\/script>/gi, '');
  html = html.replace(/\{\{\{__platform__\}\}\}/g, platformJson);
  html = html.replace(/\{\{__platform__\}\}/g, platformJson);
  html = html.replace(/\{\{\{appAvatar\}\}\}/g, '/favicon.svg');
  html = html.replace(/\{\{appAvatar\}\}/g, '/favicon.svg');
  html = html.replace(/\{\{appName\}\}/g, APP_NAME);
  html = html.replace(/\{\{appDescription\}\}/g, APP_DESCRIPTION);
  html = html.replace(/\{\{currentUrl\}\}/g, `${req.protocol}://${req.get('host')}${req.originalUrl}`);
  html = html.replace(/\{\{csrfToken\}\}/g, '');
  html = html.replace(/\{\{userId\}\}/g, 'local-user');
  html = html.replace(/\{\{tenantId\}\}/g, 'local');
  html = html.replace(/\{\{appId\}\}/g, 'local-label-audit');
  html = html.replace(/\{\{environment\}\}/g, 'local');
  html = html.replace(
    '</head>',
    '<script>window.collectEvent=window.collectEvent||function(){return undefined;};</script></head>',
  );
  return html;
}

app.use(express.static(clientDist, { index: false }));
app.get('*', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.type('html').send(renderIndexHtml(req));
});

app.listen(PORT, HOST, () => {
  console.log(`Local app running at http://${HOST}:${PORT}`);
  console.log(`OCR vision model: ${OCR_VISION_MODEL}`);
});
