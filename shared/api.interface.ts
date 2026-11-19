/* 前后端共享的类型定义 */

// ==================== 基础类型 ====================
export type RecordType = 'audit' | 'generate';
export type RecordStatus = 'pending' | 'processing' | 'success' | 'failed';

// ==================== 厂商信息类型 ====================
export interface RawMaterialSupplier {
  name: string;
  address: string;
  phone?: string;
  license?: string;
  origin?: string;
}

export interface Delegator {
  name: string;
  address: string;
  phone: string;
}

export interface EntrustedParty {
  name: string;
  address: string;
  phone?: string;
  license: string;
  origin: string;
}

export interface ManufacturerInfo {
  rawMaterialSupplier: RawMaterialSupplier;
  delegator: Delegator;
  entrustedParty: EntrustedParty;
}

// ==================== 食品信息类型 ====================
export interface FoodInfo {
  name: string;
  type: string;
  ingredients: string;
  nutrition?: string;
  netContent: string;
  tips?: string;
  productionDate?: string;
  shelfLife: string;
  storageCondition: string;
  standardCode: string;
  allergens: string[];
  /** 生产许可证编号 */
  license?: string;
}

// ==================== 多食品信息类型 ====================
export interface FoodInfoItem extends FoodInfo {
  /** 食品标题/序号，如"食品信息1" */
  title?: string;
}

export interface FoodInfoList {
  /** 是否包含多个食品 */
  isMultiFood: boolean;
  /** 食品信息列表 */
  foodList: FoodInfoItem[];
  /** 公共厂商信息（所有食品共用） */
  manufacturerInfo: ManufacturerInfo;
  /** 原始OCR文本 */
  rawText?: string;
}

// ==================== 记录相关类型 ====================
export interface RecordItem {
  id: string;
  type: RecordType;
  fileName: string;
  status: RecordStatus;
  rawData?: {
    manufacturerInfo?: ManufacturerInfo;
    manufacturerList?: ManufacturerInfo[];
    currentManufacturerIndex?: number;
    foodInfo?: FoodInfo;
    foodList?: FoodInfoItem[];
    isMultiFood?: boolean;
    rawText?: string;
  };
  resultData?: {
    auditResult?: AuditResult;
    labelPreview?: string;
    labelHtml?: string;
  };
  customStandardUrl?: string;
  exportUrl?: string;
  createdAt: string;
}

export interface RecordListResp {
  items: RecordItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface RecordListParams {
  type?: RecordType;
  page?: number;
  pageSize?: number;
  startDate?: string;
  endDate?: string;
}

export interface RecordDetailResp extends RecordItem {}

// ==================== 审核结果类型 ====================
export interface NonComplianceItem {
  standard: string;
  content: string;
  suggestion: string;
}

export interface AuditResult {
  pass: boolean;
  nonComplianceItems: NonComplianceItem[];
  totalScore: number;
}

// ==================== 标签审核 API 类型 ====================
// OCR 识别
export interface OcrReq {
  imageBase64: string;
  fileName: string;
}

export interface OcrResp {
  recordId: string;
  manufacturerInfo: ManufacturerInfo;
  foodInfo: FoodInfo;
  rawText: string;
  /** 是否包含多个食品 */
  isMultiFood: boolean;
  /** 多食品列表（仅 isMultiFood 为 true 时有数据） */
  foodList: FoodInfoItem[];
}

export type CompareSource = 'image' | 'document';

export interface LabelCompareField {
  key: string;
  label: string;
  section: string;
  imageValue: string;
  documentValue: string;
  match: boolean;
  selectedSource: CompareSource;
  finalValue: string;
}

export interface ImageDocumentCompareReq {
  foodImageBase64: string;
  foodImageFileName: string;
  nutritionImageBase64?: string;
  nutritionImageFileName?: string;
  manufacturerImageBase64?: string;
  manufacturerImageFileName?: string;
  fileName: string;
  fileType: string;
  fileData: string;
}

export interface ImageDocumentCompareResp {
  imageInfo: {
    manufacturerInfo: ManufacturerInfo;
    foodInfo: FoodInfo;
    foodList?: FoodInfoItem[];
    rawText: string;
  };
  documentInfo: {
    manufacturerInfo: ManufacturerInfo;
    foodInfo: FoodInfo;
    foodList?: FoodInfoItem[];
    rawText?: string;
  };
  fields: LabelCompareField[];
  warnings?: string[];
  summary: {
    total: number;
    matches: number;
    mismatches: number;
    missingInImage: number;
    missingInDocument: number;
  };
}

export interface ManufacturerExtractResp {
  manufacturerInfo: ManufacturerInfo;
  rawText?: string;
}

// 保存编辑后的标签信息
export interface SaveAuditReq {
  recordId: string;
  manufacturerInfo: ManufacturerInfo;
  foodInfo: FoodInfo;
  customStandardFile?: File;
}

export interface SaveAuditResp {
  success: boolean;
  recordId: string;
}

// 触发审核
export interface VerifyReq {
  recordId: string;
  useCustomStandard: boolean;
}

export interface VerifyResp {
  success: boolean;
  result: AuditResult;
}

// ==================== 标签生成 API 类型 ====================
// PDF/Word 文档提取
export interface ExtractReq {
  // FormData: file: File, keyword?: string
  keyword?: string;
}

export interface ExtractResp {
  recordId?: string;
  foodInfo?: FoodInfo;
  // 多实体提取返回
  manufacturerInfo?: ManufacturerInfo;
  manufacturerList?: ManufacturerInfo[];
  foodList?: FoodInfoItem[];
}

// 保存填写的厂商和食品信息
export interface SaveGenerateReq {
  recordId: string;
  manufacturerInfo: ManufacturerInfo;
  foodInfo: FoodInfo;
  // 多食品模式扩展字段
  isMultiFood?: boolean;
  foodList?: FoodInfoItem[];
  manufacturerList?: ManufacturerInfo[];
  // 多厂商列表字段
  rawMaterialSupplierList?: ManufacturerInfo['rawMaterialSupplier'][];
  delegatorList?: ManufacturerInfo['delegator'][];
  entrustedPartyList?: ManufacturerInfo['entrustedParty'][];
  rawText?: string;
}

export interface SaveGenerateResp {
  success: boolean;
  recordId: string;
}

// 生成标签
export interface BuildLabelReq {
  recordId: string;
  layout?: string;
}

export interface BuildLabelResp {
  success: boolean;
  labelPreview: string;
  recordId: string;
}

// ==================== 通用导出类型 ====================
// 导出响应为 Blob (Word 文件)

// ==================== 最近记录类型 ====================
export interface RecentRecordsResp {
  items: Array<{
    id: string;
    type: RecordType;
    fileName: string;
    status: RecordStatus;
    createdAt: string;
  }>;
}

// ==================== 更新记录请求 ====================
export interface UpdateRecordReq {
  rawData?: {
    manufacturerInfo?: ManufacturerInfo;
    foodInfo?: FoodInfo;
  };
  resultData?: {
    auditResult?: AuditResult;
    labelPreview?: string;
    labelHtml?: string;
  };
}

export interface UpdateRecordResp {
  success: boolean;
}

// ==================== 玛氏工厂预设信息 ====================
export const MARS_FACTORIES = [
  {
    id: 'beijing',
    name: '玛氏食品(中国)有限公司(A)',
    address: '中国北京市怀柔区雁栖经济开发区雁栖北二街9号101407',
    license: 'SC11311160415037',
    origin: '北京市',
  },
  {
    id: 'jiaxing',
    name: '玛氏食品(嘉兴)有限公司(B)',
    address: '中国浙江省嘉兴经济技术开发区西南新区圣堂路505号314036',
    license: 'SC11333040800549',
    origin: '浙江省嘉兴市',
  },
  {
    id: 'guangzhou',
    name: '玛氏箭牌糖果(中国)有限公司',
    address: '广州市黄埔区永岗路8号',
    license: 'SC11344011601116',
    origin: '广东省广州市',
  },
] as const;
