// ---- plugin:food_label_image_info_extract_1 ----
// ============================================================
// 插件 food_label_image_info_extract_1 (食品标签图片信息提取) 的类型定义
// 由 get_plugin_ai_json 自动生成
// ============================================================

export interface FoodLabelImageInfoExtractOneInput {
  /** 待解析的食品标签图片 */
  food_label_image: string[];
}

/**
 * capabilityClient.load('food_label_image_info_extract_1').call<FoodLabelImageInfoExtractOneOutput>('imageToJson', input)
 * 直接返回此类型，无 .data 包装，直接解构使用：
 * const { product_standard_number, consignee_license, food_name, ... } = result;
 */
export interface FoodLabelImageInfoExtractOneOutput {
  /** 产品标准号 */
  product_standard_number: string;
  /** 被委托方许可证 */
  consignee_license: string;
  /** 食品名称 */
  food_name: string;
  /** 配料表 */
  ingredients_list: string;
  /** 净含量 */
  net_content: string;
  /** 贮存条件 */
  storage_conditions: string;
  /** 生产许可证编号 */
  production_license_number: string;
  /** 温馨提示 */
  warm_prompt: string;
  /** 被委托方名称 */
  consignee_name: string;
  /** 委托方电话 */
  consignor_phone: string;
  /** 被委托方地址 */
  consignee_address: string;
  /** 被委托方产地 */
  consignee_origin: string;
  /** 过敏源 */
  allergen: string;
  /** 原料供应商名称 */
  raw_material_supplier_name: string;
  /** 委托方地址 */
  consignor_address: string;
  /** 保质期 */
  shelf_life: string;
  /** 委托方名称 */
  consignor_name: string;
}
// ---- end:food_label_image_info_extract_1 ----

// ---- plugin:ai_food_info_extraction_from_doc_1 ----
// ============================================================
// 插件 ai_food_info_extraction_from_doc_1 (文档食品信息结构化提取) 的类型定义
// 由 get_plugin_ai_json 自动生成
// ============================================================

export interface AiFoodInfoExtractionFromDocOneInput {
  /** 解析后的文档文本内容 */
  doc_text: string;
}

/**
 * capabilityClient.load('ai_food_info_extraction_from_doc_1').call<AiFoodInfoExtractionFromDocOneOutput>('textToJson', input)
 * 直接返回此类型，无 .data 包装，直接解构使用：
 * const { production_date, shelf_life, production_license, ... } = result;
 */
export interface AiFoodInfoExtractionFromDocOneOutput {
  /** 生产日期 */
  production_date: string;
  /** 保质期 */
  shelf_life: string;
  /** 生产许可证 */
  production_license: string;
  /** 产品标准号 */
  product_standard_number: string;
  /** 过敏源 */
  allergen: string;
  /** 温馨提示 */
  warm_prompt: string;
  /** 产品类型 */
  product_type: string;
  /** 配料表 */
  ingredients_list: string;
  /** 营养成分 */
  nutrition_facts: string;
  /** 净含量 */
  net_content: string;
  /** 贮存条件 */
  storage_condition: string;
  /** 食品名称 */
  food_name: string;
}
// ---- end:ai_food_info_extraction_from_doc_1 ----

// ---- plugin:food_label_ocr_text_info_extract_1 ----
// ============================================================
// 插件 food_label_ocr_text_info_extract_1 (食品标签OCR文本信息提取) 的类型定义
// 由 get_plugin_ai_json 自动生成
// ============================================================

export interface FoodLabelOcrTextInfoExtractOneInput {
  /** OCR提取的食品标签原始文本字符串 */
  ocr_raw_text: string;
}

/**
 * capabilityClient.load('food_label_ocr_text_info_extract_1').call<FoodLabelOcrTextInfoExtractOneOutput>('textToJson', input)
 * 直接返回此类型，无 .data 包装，直接解构使用：
 * const { 原料供应商名称, 贮存条件, 原料供应商许可证, ... } = result;
 */
export interface FoodLabelOcrTextInfoExtractOneOutput {
  /** 提供食品原料的供应商全称 */
  '原料供应商名称': string;
  /** 产品的储存要求和条件 */
  '贮存条件': string;
  /** 原料供应商的生产许可证编号（SC开头14位） */
  '原料供应商许可证': string;
  /** 委托方的详细注册地址 */
  '委托方地址': string;
  /** 产品的净含量及单位 */
  '净含量': string;
  /** 产品的保质期限 */
  '保质期': string;
  /** 产品的生产许可证编号 */
  '生产许可证编号': string;
  /** 产品委托生产的企业全称 */
  '委托方名称': string;
  /** 委托方的联系电话号码 */
  '委托方电话': string;
  /** 被委托方的详细生产地址 */
  '被委托方地址': string;
  /** 产品的全部配料清单 */
  '配料表': string;
  /** 产品执行的标准编号 */
  '产品标准号': string;
  /** 实际生产产品的企业全称 */
  '被委托方名称': string;
  /** 被委托方的生产许可证编号（SC开头14位） */
  '被委托方许可证': string;
  /** 产品实际生产的产地信息 */
  '被委托方产地': string;
  /** 产品类型，如硬质糖果、糕点、饮料等，根据常识推断 */
  '产品类型': string;
  /** 产品的正式名称 */
  '食品名称': string;
  /** 产品中含有的过敏原提示信息 */
  '过敏原': string;
  /** 产品标签上的其他温馨提示内容 */
  '温馨提示': string;
}
// ---- end:food_label_ocr_text_info_extract_1 ----

// ---- plugin:doc_text_extraction_parser_1 ----
// ============================================================
// 插件 doc_text_extraction_parser_1 (文档文本内容提取) 的类型定义
// 由 get_plugin_ai_json 自动生成
// ============================================================

export interface DocTextExtractionParserOneInput {
  /** 待解析的文档文件（支持PDF/DOC/DOCX等格式） */
  doc_file: string[];
}

/**
 * capabilityClient.load('doc_text_extraction_parser_1').call<DocTextExtractionParserOneOutput>('parseDocToMarkdown', input)
 * 直接返回此类型，无 .data 包装，直接解构使用：
 * const { content } = result;
 */
export interface DocTextExtractionParserOneOutput {
  /** 解析后的的内容, markdown 格式 */
  content: string;
}
// ---- end:doc_text_extraction_parser_1 ----

// ---- plugin:multi_food_info_extraction_from_ocr_1 ----
// ============================================================
// 插件 multi_food_info_extraction_from_ocr_1 (多食品信息提取) 的类型定义
// 由 get_plugin_ai_json 自动生成
// ============================================================

export interface MultiFoodInfoExtractionFromOcrOneInput {
  /** 食品标签OCR识别文本 */
  ocr_text: string;
}

/**
 * capabilityClient.load('multi_food_info_extraction_from_ocr_1').call<MultiFoodInfoExtractionFromOcrOneOutput>('textToJson', input)
 * 直接返回此类型，无 .data 包装，直接解构使用：
 * const { isMultiFood, foodList, manufacturerInfo } = result;
 */
export interface MultiFoodInfoExtractionFromOcrOneOutput {
  /** 是否存在多个食品信息，是则返回true，否则返回false */
  isMultiFood: boolean;
  /** 食品信息列表，items schema: {name: string(食品名称), ingredients: string(配料), netContent: string(净含量)} */
  foodList: unknown[];
  /** 厂商信息，schema: {consignor: string(委托方), consignee: string(被委托方), rawMaterialSupplier: string(原料供应商)} */
  manufacturerInfo: Record<string, unknown>;
}
// ---- end:multi_food_info_extraction_from_ocr_1 ----

// ---- plugin:food_label_multi_extract_1 ----
// ============================================================
// 插件 food_label_multi_extract_1 (多食品标签信息结构化提取) 的类型定义
// 由 get_plugin_ai_json 自动生成
// ============================================================

export interface FoodLabelMultiExtractOneInput {
  /** OCR识别的食品标签文本内容 */
  ocr_text: string;
}

/**
 * capabilityClient.load('food_label_multi_extract_1').call<FoodLabelMultiExtractOneOutput>('textToJson', input)
 * 直接返回此类型，无 .data 包装，直接解构使用：
 * const { manufacturerInfo, foodList } = result;
 */
export interface FoodLabelMultiExtractOneOutput {
  /** 厂商信息，schema: {rawMaterialSupplier: Object(原料生产商信息，schema: {name: string(名称), address: string(地址), license: string(许可证号), phone: string(联系电话), origin: string(产地)}), delegator: Object(委托方/经销商信息，schema: {name: string(名称), address: string(地址), phone: string(联系电话)}), entrustedParty: Object(被委托方/生产方信息，schema: {name: string(名称), address: string(地址), license: string(许可证号), phone: string(联系电话), origin: string(产地)})} */
  manufacturerInfo: Record<string, unknown>;
  /** 食品列表，items schema: {id: number(食品序号), title: string(食品主标题), name: string(食品名称), type: string(产品类型), ingredients: string(配料表), netContent: string(净含量), allergens: Array<string>(过敏原数组), tips: string(温馨提示)} */
  foodList: unknown[];
}
// ---- end:food_label_multi_extract_1 ----