import { Injectable, Inject, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { DRIZZLE_DATABASE, type PostgresJsDatabase, CapabilityService, FileService } from '@lark-apaas/fullstack-nestjs-core';
import { record } from '@server/database/schema';
import { eq } from 'drizzle-orm';
import {
  type ManufacturerInfo,
  type FoodInfo,
  type FoodInfoItem,
  type AuditResult,
  type NonComplianceItem,
  type ImageDocumentCompareResp,
  type LabelCompareField,
  MARS_FACTORIES,
} from '@shared/api.interface';
import { GenerateService } from '../generate/generate.service';


interface MulterLikeFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

interface ExtractedImageInfo {
  manufacturerInfo: ManufacturerInfo;
  foodInfo: FoodInfo;
  foodList: FoodInfoItem[];
  rawText: string;
  source: 'capability-image' | 'siliconflow' | 'aliyun-ocr' | 'user-ocr';
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly httpService: HttpService,
    @Inject() private readonly capabilityService: CapabilityService,
    private readonly fileService: FileService,
    private readonly generateService: GenerateService,
  ) {}

  async ocrRecognize(imageBase64: string, fileName: string): Promise<{
    recordId: string;
    manufacturerInfo: ManufacturerInfo;
    foodInfo: FoodInfo;
    rawText: string;
    isMultiFood: boolean;
    foodList: FoodInfoItem[];
  }> {
    try {
      this.logger.log(`[OCR] Start recognition, fileName: ${fileName}`);

      const extracted = await this.extractImageInfo(imageBase64, fileName);
      this.logger.log(`[OCR] Extracted by ${extracted.source}, rawText length: ${extracted.rawText.length}`);

      const recordId = await this.saveAuditData({
        fileName,
        manufacturerInfo: extracted.manufacturerInfo,
        foodInfo: extracted.foodInfo,
        rawText: extracted.rawText,
      });

      return {
        recordId,
        manufacturerInfo: extracted.manufacturerInfo,
        foodInfo: extracted.foodInfo,
        rawText: extracted.rawText,
        isMultiFood: extracted.foodList.length > 1,
        foodList: extracted.foodList,
      };
    } catch (error) {
      this.logger.error('[OCR] Recognition failed', error instanceof Error ? error.message : String(error));
      throw new Error('OCR recognition failed, please check image quality');
    }
  }

  private extractTextFromOcrResponse(data: any): string {
    if (!data) return '';

    // Check for errors
    if (data.error_code) {
      this.logger.error(`[OCR] Aliyun API error: ${data.error_msg || data.error_code}`);
      return '';
    }

    // Format 1: content (full text recognition result)
    if (data.content !== undefined && typeof data.content === 'string') {
      this.logger.log(`[OCR] Extracted text from content field, length: ${data.content.length}`);
      return data.content;
    }

    // Format 2: prism_wordsInfo (detailed recognition result)
    if (data.prism_wordsInfo && Array.isArray(data.prism_wordsInfo)) {
      const words = data.prism_wordsInfo.map((item: { word?: string }) => item.word || '').filter(Boolean);
      this.logger.log(`[OCR] Extracted text from prism_wordsInfo, total ${words.length} words`);
      return words.join('\n');
    }

    // Format 3: words_result (general text recognition)
    if (data.words_result && Array.isArray(data.words_result)) {
      const words = data.words_result.map((item: { words?: string }) => item.words || '').filter(Boolean);
      this.logger.log(`[OCR] Extracted text from words_result, total ${words.length} words`);
      return words.join('\n');
    }

    // Format 4: direct string
    if (typeof data === 'string') {
      return data;
    }

    this.logger.warn(`[OCR] Unknown response format: ${JSON.stringify(data).substring(0, 200)}`);
    return '';
  }

  private stripDataUri(base64: string): string {
    return base64.replace(/^data:.*?;base64,/, '');
  }

  private imageBase64ToBuffer(imageBase64: string): Buffer {
    return Buffer.from(this.stripDataUri(imageBase64), 'base64');
  }

  private getImageMimeType(imageBase64: string, fileName: string): string {
    const dataUriMatch = imageBase64.match(/^data:(.*?);base64,/);
    if (dataUriMatch?.[1]) return dataUriMatch[1];
    const lowerName = fileName.toLowerCase();
    if (lowerName.endsWith('.png')) return 'image/png';
    if (lowerName.endsWith('.webp')) return 'image/webp';
    return 'image/jpeg';
  }

  private getEmptyManufacturerInfo(): ManufacturerInfo {
    return {
      rawMaterialSupplier: { name: '', address: '', phone: '', license: '', origin: '' },
      delegator: { name: '', address: '', phone: '' },
      entrustedParty: { name: '', address: '', phone: '', license: '', origin: '' },
    };
  }

  private getEmptyFoodInfo(): FoodInfo {
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

  private firstValue(...values: unknown[]): string {
    for (const value of values) {
      if (value === undefined || value === null) continue;
      const text = Array.isArray(value) ? value.filter(Boolean).join('、') : String(value);
      if (text.trim()) return text.trim();
    }
    return '';
  }

  private getNestedValue(source: any, path: string): unknown {
    return path.split('.').reduce((current, key) => {
      if (current === undefined || current === null) return undefined;
      return current[key];
    }, source);
  }

  private valuesFromPaths(source: any, paths: string[]): string {
    return this.firstValue(...paths.map((path) => this.getNestedValue(source, path)));
  }

  private normalizeAllergens(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.map((item) => String(item).trim()).filter(Boolean);
    }
    if (typeof value === 'string') {
      return value.split(/[、,，;；]/).map((item) => item.trim()).filter(Boolean);
    }
    return [];
  }

  private normalizeImagePluginResult(result: any): { manufacturerInfo: ManufacturerInfo; foodInfo: FoodInfo; rawText: string } {
    const manufacturerInfo: ManufacturerInfo = {
      rawMaterialSupplier: {
        name: this.valuesFromPaths(result, ['raw_material_supplier_name', 'rawMaterialSupplier.name', '原料供应商名称', '原料生产商名称', '生产商名称']),
        address: this.valuesFromPaths(result, ['raw_material_supplier_address', 'rawMaterialSupplier.address', '原料供应商地址', '原料生产商地址', '生产商地址']),
        phone: this.valuesFromPaths(result, ['raw_material_supplier_phone', 'rawMaterialSupplier.phone', '原料供应商电话', '原料生产商电话']),
        license: this.valuesFromPaths(result, ['raw_material_supplier_license', 'rawMaterialSupplier.license', '原料供应商许可证', '原料生产商许可证']),
        origin: this.valuesFromPaths(result, ['raw_material_supplier_origin', 'rawMaterialSupplier.origin', '原料供应商产地', '原料生产商产地']),
      },
      delegator: {
        name: this.valuesFromPaths(result, ['consignor_name', 'delegator.name', '委托方名称', '经销商名称', '品牌商名称']),
        address: this.valuesFromPaths(result, ['consignor_address', 'delegator.address', '委托方地址', '经销商地址', '品牌商地址']),
        phone: this.valuesFromPaths(result, ['consignor_phone', 'delegator.phone', '委托方电话', '经销商电话', '品牌商电话']),
      },
      entrustedParty: {
        name: this.valuesFromPaths(result, ['consignee_name', 'entrustedParty.name', '被委托方名称', '受委托方名称', '分装厂名称', '代工厂名称']),
        address: this.valuesFromPaths(result, ['consignee_address', 'entrustedParty.address', '被委托方地址', '受委托方地址', '分装厂地址', '代工厂地址']),
        phone: this.valuesFromPaths(result, ['consignee_phone', 'entrustedParty.phone', '被委托方电话', '受委托方电话', '分装厂电话']),
        license: this.valuesFromPaths(result, ['consignee_license', 'entrustedParty.license', '被委托方许可证', '受委托方许可证', '分装厂许可证']),
        origin: this.valuesFromPaths(result, ['consignee_origin', 'entrustedParty.origin', '被委托方产地', '受委托方产地', '分装厂产地']),
      },
    };

    const foodInfo: FoodInfo = {
      name: this.valuesFromPaths(result, ['food_name', 'name', '食品名称', '产品名称']),
      type: this.valuesFromPaths(result, ['product_type', 'type', '产品类型', '食品类型']),
      ingredients: this.valuesFromPaths(result, ['ingredients_list', 'ingredients', '配料表', '配料']),
      nutrition: this.valuesFromPaths(result, ['nutrition_facts', 'nutrition', '营养成分表', '营养成分']),
      netContent: this.valuesFromPaths(result, ['net_content', 'netContent', '净含量']),
      productionDate: this.valuesFromPaths(result, ['production_date', 'productionDate', '生产日期']),
      shelfLife: this.valuesFromPaths(result, ['shelf_life', 'shelfLife', '保质期']),
      storageCondition: this.valuesFromPaths(result, ['storage_conditions', 'storage_condition', 'storageCondition', '贮存条件', '储存条件']),
      standardCode: this.valuesFromPaths(result, ['product_standard_number', 'standardCode', '产品标准号', '执行标准']),
      allergens: this.normalizeAllergens(this.firstValue(result?.allergen, result?.allergens, result?.['过敏原'])),
      tips: this.valuesFromPaths(result, ['warm_prompt', 'tips', '温馨提示']),
      license: this.valuesFromPaths(result, ['production_license_number', 'production_license', 'license', '生产许可证编号']),
    };

    return {
      manufacturerInfo,
      foodInfo,
      rawText: this.structuredInfoToText(manufacturerInfo, foodInfo),
    };
  }

  private normalizeFoodItem(food: any, index: number): FoodInfoItem {
    return {
      ...this.getEmptyFoodInfo(),
      name: this.valuesFromPaths(food, ['name', 'food_name', '食品名称', '产品名称']),
      type: this.valuesFromPaths(food, ['type', 'product_type', '产品类型', '食品类型']),
      ingredients: this.valuesFromPaths(food, ['ingredients', 'ingredients_list', '配料表', '配料']),
      nutrition: this.valuesFromPaths(food, ['nutrition', 'nutrition_facts', '营养成分表', '营养成分']),
      netContent: this.valuesFromPaths(food, ['netContent', 'net_content', '净含量']),
      productionDate: this.valuesFromPaths(food, ['productionDate', 'production_date', '生产日期']),
      shelfLife: this.valuesFromPaths(food, ['shelfLife', 'shelf_life', '保质期']),
      storageCondition: this.valuesFromPaths(food, ['storageCondition', 'storage_condition', 'storage_conditions', '贮存条件', '储存条件']),
      standardCode: this.valuesFromPaths(food, ['standardCode', 'product_standard_number', '产品标准号', '执行标准']),
      allergens: this.normalizeAllergens(this.firstValue(food?.allergens, food?.allergen, food?.['过敏原'])),
      tips: this.valuesFromPaths(food, ['tips', 'warm_prompt', '温馨提示']),
      title: this.valuesFromPaths(food, ['title', 'name', 'food_name', '食品名称']) || `食品${index + 1}`,
      license: this.valuesFromPaths(food, ['license', 'production_license_number', 'production_license', '生产许可证编号']),
    };
  }

  private normalizeManufacturerInfo(raw: any): ManufacturerInfo {
    const source = raw || {};
    const rawSupplier = Array.isArray(source.rawMaterialSupplier) ? source.rawMaterialSupplier[0] : source.rawMaterialSupplier;
    const rawDelegator = Array.isArray(source.delegator) ? source.delegator[0] : source.delegator;
    const rawEntrusted = Array.isArray(source.entrustedParty) ? source.entrustedParty[0] : source.entrustedParty;

    return {
      rawMaterialSupplier: {
        name: this.firstValue(rawSupplier?.name, rawSupplier?.['名称'], source?.['原料生产商']?.name, source?.['生产商']?.name, source?.rawMaterialSupplier),
        address: this.firstValue(rawSupplier?.address, rawSupplier?.['地址']),
        phone: this.firstValue(rawSupplier?.phone, rawSupplier?.['电话']),
        license: this.firstValue(rawSupplier?.license, rawSupplier?.['许可证编号']),
        origin: this.firstValue(rawSupplier?.origin, rawSupplier?.['产地']),
      },
      delegator: {
        name: this.firstValue(rawDelegator?.name, rawDelegator?.['名称'], source?.['委托方']?.name, source?.delegator),
        address: this.firstValue(rawDelegator?.address, rawDelegator?.['地址']),
        phone: this.firstValue(rawDelegator?.phone, rawDelegator?.['电话']),
      },
      entrustedParty: {
        name: this.firstValue(rawEntrusted?.name, rawEntrusted?.['名称'], source?.['被委托方']?.name, source?.entrustedParty),
        address: this.firstValue(rawEntrusted?.address, rawEntrusted?.['地址']),
        phone: this.firstValue(rawEntrusted?.phone, rawEntrusted?.['电话']),
        license: this.firstValue(rawEntrusted?.license, rawEntrusted?.['许可证编号']),
        origin: this.firstValue(rawEntrusted?.origin, rawEntrusted?.['产地']),
      },
    };
  }

  private normalizeDocumentResult(result: any): { manufacturerInfo: ManufacturerInfo; foodInfo: FoodInfo; foodList: FoodInfoItem[] } {
    const foodList = Array.isArray(result?.foodList)
      ? result.foodList.map((food: any, index: number) => this.normalizeFoodItem(food, index))
      : result?.foodInfo
        ? [this.normalizeFoodItem(result.foodInfo, 0)]
        : [];
    const firstFood = foodList[0] || this.getEmptyFoodInfo();
    return {
      manufacturerInfo: this.normalizeManufacturerInfo(result?.manufacturerInfo),
      foodInfo: firstFood,
      foodList,
    };
  }

  private mergeFoodInfo(primary: FoodInfo, secondary?: Partial<FoodInfo>): FoodInfo {
    if (!secondary) return primary;
    return {
      ...primary,
      name: primary.name || secondary.name || '',
      type: primary.type || secondary.type || '',
      ingredients: primary.ingredients || secondary.ingredients || '',
      nutrition: primary.nutrition || secondary.nutrition || '',
      netContent: primary.netContent || secondary.netContent || '',
      productionDate: primary.productionDate || secondary.productionDate || '',
      shelfLife: primary.shelfLife || secondary.shelfLife || '',
      storageCondition: primary.storageCondition || secondary.storageCondition || '',
      standardCode: primary.standardCode || secondary.standardCode || '',
      allergens: primary.allergens?.length ? primary.allergens : (secondary.allergens || []),
      tips: primary.tips || secondary.tips || '',
      license: primary.license || secondary.license || '',
    };
  }

  private structuredInfoToText(manufacturerInfo: ManufacturerInfo, foodInfo: FoodInfo): string {
    const lines = [
      `食品名称：${foodInfo.name || ''}`,
      `产品类型：${foodInfo.type || ''}`,
      `配料表：${foodInfo.ingredients || ''}`,
      `营养成分表：${foodInfo.nutrition || ''}`,
      `净含量：${foodInfo.netContent || ''}`,
      `保质期：${foodInfo.shelfLife || ''}`,
      `贮存条件：${foodInfo.storageCondition || ''}`,
      `产品标准号：${foodInfo.standardCode || ''}`,
      `生产许可证编号：${foodInfo.license || ''}`,
      `过敏原：${foodInfo.allergens?.join('、') || ''}`,
      `温馨提示：${foodInfo.tips || ''}`,
      `原料生产商名称：${manufacturerInfo.rawMaterialSupplier.name || ''}`,
      `原料生产商地址：${manufacturerInfo.rawMaterialSupplier.address || ''}`,
      `原料生产商许可证：${manufacturerInfo.rawMaterialSupplier.license || ''}`,
      `委托方名称：${manufacturerInfo.delegator.name || ''}`,
      `委托方地址：${manufacturerInfo.delegator.address || ''}`,
      `委托方电话：${manufacturerInfo.delegator.phone || ''}`,
      `被委托方名称：${manufacturerInfo.entrustedParty.name || ''}`,
      `被委托方地址：${manufacturerInfo.entrustedParty.address || ''}`,
      `被委托方许可证：${manufacturerInfo.entrustedParty.license || ''}`,
      `被委托方产地：${manufacturerInfo.entrustedParty.origin || ''}`,
    ];
    return lines.filter((line) => !line.endsWith('：')).join('\n');
  }

  /**
   * 自带 OCR：调用使用者自己的 OCR / 视觉大模型（见 server/ocr-provider.js）。
   * 支持任何兼容 OpenAI Chat Completions 的服务，配置写在 .env 中。
   */
  private async extractImageInfoWithUserOcr(imageBase64: string, fileName: string): Promise<ExtractedImageInfo> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { callOcr } = require('../../ocr-provider');
    const mimeType = this.getImageMimeType(imageBase64, fileName);
    const imageUrl = imageBase64.startsWith('data:')
      ? imageBase64
      : `data:${mimeType};base64,${this.stripDataUri(imageBase64)}`;

    const raw = await callOcr([
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: '请从食品包装标签图片中提取结构化JSON。字段包括manufacturerInfo.rawMaterialSupplier/delegator/entrustedParty和foodInfo.name/type/ingredients/nutrition/netContent/shelfLife/storageCondition/standardCode/allergens/tips/license。生产商填rawMaterialSupplier，被委托方/分装厂填entrustedParty，经销商/委托方填delegator。只返回JSON。',
          },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      },
    ]);

    const manufacturerInfo = this.normalizeManufacturerInfo(raw?.manufacturerInfo);
    const foodInfo = this.normalizeFoodItem(raw?.foodInfo || {}, 0);
    const foodList = Array.isArray(raw?.foodList) && raw.foodList.length
      ? raw.foodList.map((item: any, index: number) => this.normalizeFoodItem(item, index))
      : [foodInfo];
    return {
      manufacturerInfo,
      foodInfo,
      foodList,
      rawText: this.structuredInfoToText(manufacturerInfo, foodInfo),
      source: 'user-ocr',
    };
  }

  async extractImageInfo(imageBase64: string, fileName: string): Promise<ExtractedImageInfo> {
    try {
      return await this.extractImageInfoWithUserOcr(imageBase64, fileName);
    } catch (error) {
      this.logger.warn('[OCR] 自带 OCR 未配置或调用失败，返回空结构。请在 .env 配置 OCR_BASE_URL / OCR_API_KEY / OCR_VISION_MODEL', error);
      const manufacturerInfo = this.getEmptyManufacturerInfo();
      const foodInfo = this.getEmptyFoodInfo();
      return { manufacturerInfo, foodInfo, foodList: [], rawText: '', source: 'user-ocr' };
    }
  }

  private normalizeComparableValue(value: string): string {
    return value
      .replace(/\s+/g, '')
      .replace(/[，。；：、,.。;:]/g, '')
      .toLowerCase();
  }

  private createCompareField(
    key: string,
    label: string,
    section: LabelCompareField['section'],
    imageValue: string | undefined,
    documentValue: string | undefined,
  ): LabelCompareField {
    const finalImageValue = imageValue || '';
    const finalDocumentValue = documentValue || '';
    const imageComparable = this.normalizeComparableValue(finalImageValue);
    const documentComparable = this.normalizeComparableValue(finalDocumentValue);
    const match = imageComparable !== '' && imageComparable === documentComparable;
    const selectedSource = finalImageValue.trim() ? 'image' : 'document';

    return {
      key,
      label,
      section,
      imageValue: finalImageValue,
      documentValue: finalDocumentValue,
      match,
      selectedSource,
      finalValue: selectedSource === 'image' ? finalImageValue : finalDocumentValue,
    };
  }

  private buildCompareFields(imageInfo: ExtractedImageInfo, documentInfo: { manufacturerInfo: ManufacturerInfo; foodInfo: FoodInfo }): LabelCompareField[] {
    const imageFood = imageInfo.foodInfo;
    const documentFood = documentInfo.foodInfo;
    const imageMfg = imageInfo.manufacturerInfo;
    const docMfg = documentInfo.manufacturerInfo;

    return [
      this.createCompareField('food.name', '食品名称/产品名称', '食品信息', imageFood.name, documentFood.name),
      this.createCompareField('food.type', '产品类型', '食品信息', imageFood.type, documentFood.type),
      this.createCompareField('food.ingredients', '配料表', '食品信息', imageFood.ingredients, documentFood.ingredients),
      this.createCompareField('food.netContent', '净含量', '食品信息', imageFood.netContent, documentFood.netContent),
      this.createCompareField('food.shelfLife', '保质期', '食品信息', imageFood.shelfLife, documentFood.shelfLife),
      this.createCompareField('food.storageCondition', '贮存条件', '食品信息', imageFood.storageCondition, documentFood.storageCondition),
      this.createCompareField('food.standardCode', '产品标准号', '食品信息', imageFood.standardCode, documentFood.standardCode),
      this.createCompareField('food.license', '生产许可证编号', '食品信息', imageFood.license, documentFood.license),
      this.createCompareField('food.allergens', '过敏原', '食品信息', imageFood.allergens?.join('、'), documentFood.allergens?.join('、')),
      this.createCompareField('food.tips', '温馨提示', '食品信息', imageFood.tips, documentFood.tips),
      this.createCompareField('food.nutrition', '营养成分表', '营养成分', imageFood.nutrition, documentFood.nutrition),
      this.createCompareField('manufacturer.rawMaterialSupplier.name', '原料生产商名称', '厂商信息', imageMfg.rawMaterialSupplier.name, docMfg.rawMaterialSupplier.name),
      this.createCompareField('manufacturer.rawMaterialSupplier.address', '原料生产商地址', '厂商信息', imageMfg.rawMaterialSupplier.address, docMfg.rawMaterialSupplier.address),
      this.createCompareField('manufacturer.rawMaterialSupplier.license', '原料生产商许可证', '厂商信息', imageMfg.rawMaterialSupplier.license, docMfg.rawMaterialSupplier.license),
      this.createCompareField('manufacturer.delegator.name', '委托方名称', '厂商信息', imageMfg.delegator.name, docMfg.delegator.name),
      this.createCompareField('manufacturer.delegator.address', '委托方地址', '厂商信息', imageMfg.delegator.address, docMfg.delegator.address),
      this.createCompareField('manufacturer.delegator.phone', '委托方电话', '厂商信息', imageMfg.delegator.phone, docMfg.delegator.phone),
      this.createCompareField('manufacturer.entrustedParty.name', '被委托方名称', '厂商信息', imageMfg.entrustedParty.name, docMfg.entrustedParty.name),
      this.createCompareField('manufacturer.entrustedParty.address', '被委托方地址', '厂商信息', imageMfg.entrustedParty.address, docMfg.entrustedParty.address),
      this.createCompareField('manufacturer.entrustedParty.license', '被委托方许可证', '厂商信息', imageMfg.entrustedParty.license, docMfg.entrustedParty.license),
      this.createCompareField('manufacturer.entrustedParty.origin', '被委托方产地', '厂商信息', imageMfg.entrustedParty.origin, docMfg.entrustedParty.origin),
    ].filter((field) => field.imageValue || field.documentValue);
  }

  async compareImageWithDocument(params: {
    foodImageBase64: string;
    foodImageFileName: string;
    nutritionImageBase64?: string;
    nutritionImageFileName?: string;
    file: MulterLikeFile;
  }): Promise<ImageDocumentCompareResp> {
    const foodImageInfo = await this.extractImageInfo(params.foodImageBase64, params.foodImageFileName);
    let mergedImageInfo = foodImageInfo;

    if (params.nutritionImageBase64) {
      const nutritionImageInfo = await this.extractImageInfo(
        params.nutritionImageBase64,
        params.nutritionImageFileName || 'nutrition-image',
      );
      mergedImageInfo = {
        ...foodImageInfo,
        foodInfo: this.mergeFoodInfo(foodImageInfo.foodInfo, nutritionImageInfo.foodInfo),
        rawText: [foodImageInfo.rawText, nutritionImageInfo.rawText].filter(Boolean).join('\n\n--- 营养成分截图 ---\n'),
      };
      mergedImageInfo.foodList = [mergedImageInfo.foodInfo];
    }

    const documentExtraction = await this.generateService.extractFromDocumentWithRawText(params.file);
    const normalizedDoc = this.normalizeDocumentResult(documentExtraction.parsed);
    const fields = this.buildCompareFields(mergedImageInfo, normalizedDoc);

    return {
      imageInfo: {
        manufacturerInfo: mergedImageInfo.manufacturerInfo,
        foodInfo: mergedImageInfo.foodInfo,
        foodList: mergedImageInfo.foodList,
        rawText: mergedImageInfo.rawText,
      },
      documentInfo: {
        manufacturerInfo: normalizedDoc.manufacturerInfo,
        foodInfo: normalizedDoc.foodInfo,
        foodList: normalizedDoc.foodList,
        rawText: documentExtraction.rawText,
      },
      fields,
      summary: {
        total: fields.length,
        matches: fields.filter((field) => field.match).length,
        mismatches: fields.filter((field) => !field.match).length,
        missingInImage: fields.filter((field) => !field.imageValue && field.documentValue).length,
        missingInDocument: fields.filter((field) => field.imageValue && !field.documentValue).length,
      },
    };
  }

  async saveAuditData(params: {
    fileName: string;
    manufacturerInfo: ManufacturerInfo;
    foodInfo: FoodInfo;
    rawText?: string;
  }): Promise<string> {
    const { fileName, manufacturerInfo, foodInfo, rawText } = params;

    const result = await this.db.insert(record).values({
      type: 'audit',
      fileName,
      status: 'success',
      rawData: { manufacturerInfo, foodInfo, rawText },
    }).returning({ id: record.id });

    return result[0].id;
  }

  async verifyLabel(recordId: string, useCustomStandard: boolean): Promise<{
    success: boolean;
    result: AuditResult;
  }> {
    const recordData = await this.getRecordById(recordId);
    const rawData = recordData.rawData as { manufacturerInfo: ManufacturerInfo; foodInfo: FoodInfo };

    const items: NonComplianceItem[] = [];

    // 1. GB7718-2025 standard audit
    const gb7718Items = this.verifyGB7718Standard(rawData.manufacturerInfo, rawData.foodInfo);
    items.push(...gb7718Items);

    // 2. Mars factory standard audit
    const marsItems = this.verifyMarsStandard(rawData.manufacturerInfo, rawData.foodInfo);
    items.push(...marsItems);

    // 3. Custom standard audit
    if (useCustomStandard && recordData.customStandardUrl) {
      const customItems = await this.verifyCustomStandard(rawData.manufacturerInfo, rawData.foodInfo, recordData.customStandardUrl);
      items.push(...customItems);
    }

    // Calculate total score
    const totalScore = this.calculateScore(items);
    const passed = items.length === 0;

    const auditResult: AuditResult = {
      pass: passed,
      nonComplianceItems: items,
      totalScore,
    };

    // Save audit result
    await this.db.update(record)
      .set({ resultData: auditResult })
      .where(eq(record.id, recordId));

    return { success: true, result: auditResult };
  }

  private verifyMarsStandard(manufacturerInfo: ManufacturerInfo, foodInfo: FoodInfo): NonComplianceItem[] {
    const items: NonComplianceItem[] = [];

    // Check if raw material supplier is one of Mars factories
    const rawMaterialName = manufacturerInfo.rawMaterialSupplier.name;
    const isValidMarsFactory = MARS_FACTORIES.some(factory =>
      rawMaterialName.includes(factory.name) || factory.name.includes(rawMaterialName)
    );

    if (!isValidMarsFactory && rawMaterialName) {
      items.push({
        standard: 'Mars Standard',
        content: `Raw material supplier "${rawMaterialName}" is not a Mars-authorized factory`,
        suggestion: 'Raw material supplier must be one of Mars Food (China) Co., Ltd., Mars Food (Jiaxing) Co., Ltd., or Mars Wrigley Confectionery (China) Co., Ltd.',
      });
    }

    // Check delegator information completeness
    if (!manufacturerInfo.delegator.name || !manufacturerInfo.delegator.address || !manufacturerInfo.delegator.phone) {
      items.push({
        standard: 'Mars Standard',
        content: 'Delegator (distributor) information is incomplete',
        suggestion: 'Must include full delegator name, address, and contact phone',
      });
    }

    // Check if distributor phone is Mars 400 number
    const delegatorPhone = manufacturerInfo.delegator.phone;
    if (delegatorPhone && delegatorPhone.includes('400-830-1099')) {
      items.push({
        standard: 'Mars Standard',
        content: 'Distributor contact phone uses Mars 400 number',
        suggestion: 'Using only Mars Wrigley 400-830-1099 as distributor contact is prohibited; must provide distributor\'s own reachable landline or mobile',
      });
    }

    // Check entrusted party information completeness
    if (!manufacturerInfo.entrustedParty.name || !manufacturerInfo.entrustedParty.address ||
        !manufacturerInfo.entrustedParty.license || !manufacturerInfo.entrustedParty.origin) {
      items.push({
        standard: 'Mars Standard',
        content: 'Entrusted party (packaging factory) information is incomplete',
        suggestion: 'Must include full entrusted party name, address, food production license number, and origin',
      });
    }

    return items;
  }

  private verifyGB7718Standard(manufacturerInfo: ManufacturerInfo, foodInfo: FoodInfo): NonComplianceItem[] {
    const items: NonComplianceItem[] = [];

    // 1. Basic information completeness check
    const requiredFields = [
      { field: manufacturerInfo.rawMaterialSupplier.name, name: 'Raw Material Supplier Name' },
      { field: manufacturerInfo.delegator.name, name: 'Delegator Name' },
      { field: manufacturerInfo.delegator.address, name: 'Delegator Address' },
      { field: manufacturerInfo.delegator.phone, name: 'Delegator Phone' },
      { field: manufacturerInfo.entrustedParty.name, name: 'Entrusted Party Name' },
      { field: manufacturerInfo.entrustedParty.address, name: 'Entrusted Party Address' },
      { field: manufacturerInfo.entrustedParty.license, name: 'Food Production License Number' },
      { field: foodInfo.name, name: 'Food Name' },
      { field: foodInfo.ingredients, name: 'Ingredients List' },
      { field: foodInfo.netContent, name: 'Net Content' },
      { field: foodInfo.shelfLife, name: 'Shelf Life' },
      { field: foodInfo.storageCondition, name: 'Storage Condition' },
    ];

    for (const { field, name } of requiredFields) {
      if (!field || field.trim() === '') {
        items.push({
          standard: 'GB7718-2025',
          content: `${name} is empty`,
          suggestion: `Please provide ${name}`,
        });
      }
    }

    // 2. Net content format check
    if (foodInfo.netContent && !/\d+\s*[克gG毫升mlML升L]+/.test(foodInfo.netContent)) {
      items.push({
        standard: 'GB7718-2025',
        content: 'Net content format is invalid',
        suggestion: 'Net content should include number and unit (e.g., 100g, 250ml)',
      });
    }

    // 3. Production license format check
    if (manufacturerInfo.entrustedParty.license && !/SC\d{14}/.test(manufacturerInfo.entrustedParty.license)) {
      items.push({
        standard: 'GB7718-2025',
        content: 'Food production license number format is incorrect',
        suggestion: 'Should start with SC followed by 14 digits',
      });
    }

    return items;
  }

  private async verifyCustomStandard(
    manufacturerInfo: ManufacturerInfo,
    foodInfo: FoodInfo,
    customStandardUrl: string,
  ): Promise<NonComplianceItem[]> {
    // TODO: Implement custom standard audit logic
    this.logger.log(`[Audit] Using custom standard: ${customStandardUrl}`);
    return [];
  }

  private calculateScore(items: NonComplianceItem[]): number {
    if (items.length === 0) return 100;

    // Calculate score based on number and severity of non-compliance items
    const criticalCount = items.filter(item => item.standard === 'Mars Standard').length;
    const normalCount = items.filter(item => item.standard === 'GB7718-2025').length;

    let score = 100;
    score -= criticalCount * 15;
    score -= normalCount * 5;

    return Math.max(0, score);
  }

  async updateRecord(recordId: string, data: Partial<typeof record.$inferInsert>) {
    await this.db.update(record)
      .set(data)
      .where(eq(record.id, recordId));
  }

  async getRecordById(recordId: string) {
    const result = await this.db.select()
      .from(record)
      .where(eq(record.id, recordId))
      .limit(1);

    if (result.length === 0) {
      throw new Error('Record not found');
    }

    return result[0];
  }

  private parseManufacturerInfo(text: string): ManufacturerInfo {
    const lines = text.split(/\r?\n/);

    // 使用上下文提取来确保地址与对应的公司匹配
    const delegatorName = this.extractCompanyName(text, ['委托方', '经销商', '委托商']) || '';
    const entrustedPartyName = this.extractCompanyName(text, ['被委托方', '受委托方', '分装厂', '生产厂']) || '';
    
    // 委托方地址：从"委托方"后面开始搜索，遇到"被委托方"或其他公司相关词停止
    const delegatorAddress = this.extractAddressFromContext(
      text, 
      '委托方', 
      ['被委托方', '受委托方', '分装厂', '生产厂', '原料', '生产商']
    );
    
    // 被委托方地址：从"被委托方"后面开始搜索，遇到"委托方"或其他公司相关词停止
    const entrustedPartyAddress = this.extractAddressFromContext(
      text,
      '被委托方',
      ['委托方', '经销商', '委托商', '原料', '生产商']
    );

    // 提取SC许可证号（更精确的匹配）
    const scLicense = this.extractSCLicense(text);
    
    return {
      rawMaterialSupplier: {
        name: this.extractCompanyName(text, ['原料生产商', '生产商', '制造商', '生产厂家']) || '',
        address: '',
        phone: '',
      },
      delegator: {
        name: delegatorName,
        address: delegatorAddress,
        phone: this.extractFieldClean(text, ['联系电话', '电话', '联系方式']) || '',
      },
      entrustedParty: {
        name: entrustedPartyName,
        address: entrustedPartyAddress,
        phone: '',
        license: scLicense || this.extractFieldClean(text, ['食品生产许可证编号', '生产许可证', '许可证编号']) || '',
        origin: this.extractFieldClean(text, ['产地', '原产国', '原产地']) || '',
      },
    };
  }

  private extractAddress(text: string, keywords: string[]): string {
    // 地理关键词 - 地址必须包含其中之一
    const geoKeywords = ['省', '市', '县', '区', '镇', '乡', '村', '路', '街', '道', '巷', '号', '栋', '单元', '楼'];
    // 非地理关键词 - 地址不应该包含这些
    const nonGeoKeywords = ['防潮', '食用', '保存', '储存', '贮藏', '温度', '湿度', '开封', '包装', '注意事项'];
    
    for (const keyword of keywords) {
      const regex = new RegExp(`${keyword}[：:\\s]*([^\\n\\r]{0,50})`, 'i');
      const match = text.match(regex);
      if (match && match[1]) {
        const value = match[1].trim();
        // 检查是否包含地理关键词
        const hasGeoKeyword = geoKeywords.some(gk => value.includes(gk));
        // 检查是否包含非地理关键词
        const hasNonGeoKeyword = nonGeoKeywords.some(ngk => value.includes(ngk));
        
        if (hasGeoKeyword && !hasNonGeoKeyword) {
          return value;
        }
      }
    }

    return '';
  }

  /**
   * 从特定上下文区域提取地址
   * @param text 完整文本
   * @param startKeyword 起始关键词（如"委托方"）
   * @param endKeywords 结束关键词列表（遇到这些词停止搜索）
   */
  private extractAddressFromContext(text: string, startKeyword: string, endKeywords: string[]): string {
    const geoKeywords = ['省', '市', '县', '区', '镇', '乡', '村', '路', '街', '道', '巷', '号', '栋', '单元', '楼'];
    const nonGeoKeywords = ['防潮', '食用', '保存', '储存', '贮藏', '温度', '湿度', '开封', '包装', '注意事项'];
    
    // 找到起始关键词的位置
    const startRegex = new RegExp(`${startKeyword}[：:\\s]*`, 'i');
    const startMatch = text.match(startRegex);
    if (!startMatch) return '';
    
    const startIndex = text.indexOf(startMatch[0]);
    if (startIndex === -1) return '';
    
    // 从开始位置往后搜索，直到遇到结束关键词
    const searchText = text.substring(startIndex + startMatch[0].length);
    const lines = searchText.split(/\r?\n/);
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;
      
      // 检查是否遇到结束关键词
      if (endKeywords.some(ek => trimmedLine.includes(ek))) {
        break;
      }
      
      // 检查是否是地址行
      const hasGeoKeyword = geoKeywords.some(gk => trimmedLine.includes(gk));
      const hasNonGeoKeyword = nonGeoKeywords.some(ngk => trimmedLine.includes(ngk));
      
      if (hasGeoKeyword && !hasNonGeoKeyword) {
        // 清理地址内容
        const address = trimmedLine.replace(/^[：:\s]+/, '').trim();
        if (address.length > 5) {
          return address;
        }
      }
    }
    
    return '';
  }

  private extractCompanyName(text: string, keywords: string[]): string {
    const lines = text.split(/\r?\n/);
    
    for (const keyword of keywords) {
      // 尝试在行内匹配：关键词 + 公司名称（包含公司、厂、企业等）
      const regex1 = new RegExp(`${keyword}[：:\s]*([^\n\r]{0,50}(?:公司|厂|企业|有限公司|股份公司|集团))`, 'i');
      const match1 = text.match(regex1);
      if (match1 && match1[1]) {
        const name = match1[1].trim();
        // 确保公司名称长度合理（至少4个字符）
        if (name.length >= 4) {
          return name;
        }
      }
      
      // 尝试匹配下一行（标签上公司名通常在关键词下一行）
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.includes(keyword) || new RegExp(keyword, 'i').test(line)) {
          // 检查下一行
          if (i + 1 < lines.length) {
            const nextLine = lines[i + 1].trim();
            // 下一行包含公司特征词且不是纯地址
            if (/(公司|厂|企业|有限公司|股份公司|集团)/.test(nextLine) && 
                !/^(省|市|县|区|路|街|号)/.test(nextLine) &&
                nextLine.length >= 4 && nextLine.length <= 50) {
              return nextLine;
            }
          }
          // 检查当前行冒号后的内容
          const colonMatch = line.match(/[：:]\s*(.+)/);
          if (colonMatch && colonMatch[1]) {
            const value = colonMatch[1].trim();
            if (/(公司|厂|企业|有限公司)/.test(value) && value.length >= 4) {
              return value;
            }
          }
        }
      }
    }
    return '';
  }

  /**
   * 提取SC开头的食品生产许可证号
   */
  private extractSCLicense(text: string): string {
    // 匹配SC开头 + 14位数字的标准格式
    const scRegex = /SC\d{14}/;
    const match = text.match(scRegex);
    if (match) {
      return match[0];
    }
    
    // 尝试从关键字附近提取
    const keywords = ['食品生产许可证编号', '生产许可证', '许可证编号', 'SC'];
    const lines = text.split(/\r?\n/);
    
    for (const line of lines) {
      for (const keyword of keywords) {
        if (line.includes(keyword)) {
          // 提取行中的SC编号
          const scMatch = line.match(/SC\d{14}/);
          if (scMatch) {
            return scMatch[0];
          }
          // 提取冒号后的内容
          const colonMatch = line.match(/[：:]\s*(SC\d+)/i);
          if (colonMatch && colonMatch[1]) {
            const scCode = colonMatch[1].toUpperCase();
            if (scCode.startsWith('SC') && scCode.length >= 16) {
              return scCode.substring(0, 16); // 确保是SC+14位数字
            }
          }
        }
      }
    }
    return '';
  }

  private parseFoodInfo(text: string): FoodInfo {
    const lines = text.split(/\r?\n/);
    // 优先使用SC专用提取方法获取许可证号
    const scLicense = this.extractSCLicense(text);

    return {
      name: this.extractProductName(text) || this.extractFieldClean(text, ['食品名称', '产品名称', '品名']) || '',
      type: '预包装食品',
      ingredients: this.extractFieldClean(text, ['配料', '配料表', '原料']) || '',
      nutrition: '',
      netContent: this.extractFieldClean(text, ['净含量', '含量', '规格']) || '',
      productionDate: '',
      shelfLife: this.extractFieldClean(text, ['保质期', '保存期']) || '',
      storageCondition: this.extractFieldClean(text, ['贮存条件', '贮藏条件', '储存条件', '保存方法']) || '',
      standardCode: this.extractFieldClean(text, ['产品标准号', '执行标准', '标准代号']) || '',
      allergens: [],
      tips: this.extractTips(text) || '',
    };
  }

  private extractProductName(text: string): string {
    const lines = text.split(/\r?\n/).slice(0, 20).filter(l => l.trim().length > 2);
    const wordCount: Record<string, number> = {};

    for (const line of lines) {
      for (let i = 0; i < line.length - 1; i++) {
        for (let len = 2; len <= 8 && i + len <= line.length; len++) {
          const phrase = line.substring(i, i + len).trim();
          if (phrase.length >= 2 && !/[，。！？、\s]/.test(phrase)) {
            wordCount[phrase] = (wordCount[phrase] || 0) + 1;
          }
        }
      }
    }

    let bestPhrase = '';
    let bestCount = 0;
    for (const [phrase, count] of Object.entries(wordCount)) {
      if (count > bestCount && count >= 2 && phrase.length >= 3) {
        bestCount = count;
        bestPhrase = phrase;
      }
    }

    return bestPhrase;
  }

  private extractTips(text: string): string {
    const tipsKeywords = ['温馨提示', '温馨提示：', '注意', '注意：', '警示', '警示：', '提醒', '提醒：'];
    for (const keyword of tipsKeywords) {
      const regex = new RegExp(`${keyword}([^\\n\\r]{0,200})`, 'i');
      const match = text.match(regex);
      if (match && match[1]) {
        return (keyword + match[1]).trim();
      }
    }
    return '';
  }

  private extractFieldClean(text: string, keywords: string[]): string {
    const lines = text.split(/\r?\n/);
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;
      
      for (const keyword of keywords) {
        // Match keyword followed by colon or space
        const regex = new RegExp(`^${keyword}[：:\\s]+(.+)$`, 'i');
        const match = trimmedLine.match(regex);
        
        if (match && match[1]) {
          let value = match[1].trim();
          // Remove trailing markers or empty content
          value = value.replace(/[：:].*$/, '').trim();
          if (value && value.length > 0) {
            return value;
          }
        }
      }
    }
    return '';
  }

  async exportAuditReport(recordId: string): Promise<Buffer> {
    const recordData = await this.getRecordById(recordId);
    const rawData = recordData.rawData as { manufacturerInfo: ManufacturerInfo; foodInfo: FoodInfo };
    const resultData = recordData.resultData as AuditResult | undefined;

    // Create simple HTML report
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Food Label Audit Report</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 20px; }
    h1 { color: #333; }
    h2 { color: #666; margin-top: 30px; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
    th { background-color: #f5f5f5; }
    .pass { color: green; }
    .fail { color: red; }
    .score { font-size: 24px; font-weight: bold; }
  </style>
</head>
<body>
  <h1>Food Label Audit Report</h1>
  <p>File Name: ${recordData.fileName}</p>
  <p>Audit Time: ${new Date().toLocaleString()}</p>

  <h2>Audit Result</h2>
  <p>Status: <span class="${resultData?.pass ? 'pass' : 'fail'}">${resultData?.pass ? 'Pass' : 'Fail'}</span></p>
  <p class="score">Total Score: ${resultData?.totalScore || 0}</p>
  
  <h2>Manufacturer Info</h2>
  <table>
    <tr><th>Item</th><th>Content</th></tr>
    <tr><td>Raw Material Supplier</td><td>${rawData.manufacturerInfo.rawMaterialSupplier.name}</td></tr>
    <tr><td>Delegator</td><td>${rawData.manufacturerInfo.delegator.name}</td></tr>
    <tr><td>Delegator Address</td><td>${rawData.manufacturerInfo.delegator.address}</td></tr>
    <tr><td>Delegator Phone</td><td>${rawData.manufacturerInfo.delegator.phone}</td></tr>
    <tr><td>Entrusted Party</td><td>${rawData.manufacturerInfo.entrustedParty.name}</td></tr>
    <tr><td>Entrusted Party Address</td><td>${rawData.manufacturerInfo.entrustedParty.address}</td></tr>
    <tr><td>License Number</td><td>${rawData.manufacturerInfo.entrustedParty.license}</td></tr>
  </table>
  
  <h2>Food Info</h2>
  <table>
    <tr><th>Item</th><th>Content</th></tr>
    <tr><td>Food Name</td><td>${rawData.foodInfo.name}</td></tr>
    <tr><td>Ingredients List</td><td>${rawData.foodInfo.ingredients}</td></tr>
    <tr><td>Net Content</td><td>${rawData.foodInfo.netContent}</td></tr>
    <tr><td>Shelf Life</td><td>${rawData.foodInfo.shelfLife}</td></tr>
    <tr><td>Storage Condition</td><td>${rawData.foodInfo.storageCondition}</td></tr>
  </table>
  
  ${resultData?.nonComplianceItems && resultData.nonComplianceItems.length > 0 ? `
  <h2>Non-Compliance Items</h2>
  <table>
    <tr><th>Standard</th><th>Issue</th><th>Suggestion</th></tr>
    ${resultData.nonComplianceItems.map(item => `
      <tr>
        <td>${item.standard}</td>
        <td>${item.content}</td>
        <td>${item.suggestion}</td>
      </tr>
    `).join('')}
  </table>
  ` : '<p>No non-compliance items found</p>'}
</body>
</html>`;

    return Buffer.from(htmlContent, 'utf-8');
  }
}
