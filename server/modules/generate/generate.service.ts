import { Injectable, Logger, Inject } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase, CapabilityService, FileService } from '@lark-apaas/fullstack-nestjs-core';
import { record } from '@server/database/schema';
import { eq } from 'drizzle-orm';
import type {
  ManufacturerInfo,
  FoodInfo,
  FoodInfoItem,
} from '@shared/api.interface';

// AI插件返回的食品信息结构
interface AIFoodInfoExtractResult {
  food_name?: string;
  product_type?: string;
  ingredients_list?: string;
  nutrition_facts?: string;
  net_content?: string;
  production_date?: string;
  shelf_life?: string;
  storage_condition?: string;
  production_license?: string;
  product_standard_number?: string;
  allergen?: string;
  warm_prompt?: string;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mammoth = require('mammoth');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParseLib = require('pdf-parse');
const PDFParseClass = pdfParseLib.PDFParse;

interface MulterFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

interface ExtractedDocumentPayload {
  rawText: string;
  parsed: any;
}

@Injectable()
export class GenerateService {
  private readonly logger = new Logger(GenerateService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    @Inject() private readonly capabilityService: CapabilityService,
    private readonly fileService: FileService,
  ) {}

  /**
   * Extract food information from PDF or Word documents
   */
  async extractFromDocument(file: MulterFile, keyword?: string): Promise<any> {
    const { parsed } = await this.extractFromDocumentWithRawText(file, keyword);
    return parsed;
  }

  async extractFromDocumentWithRawText(file: MulterFile, keyword?: string): Promise<ExtractedDocumentPayload> {
    try {
      const fileBuffer = file.buffer;
      const fileName = file.originalname.toLowerCase();
      this.logger.log(`[DocumentExtract] Starting extraction for file: ${fileName}, size: ${file.size} bytes`);
      
      let textContent = '';

      if (fileName.endsWith('.pdf')) {
        this.logger.log('[DocumentExtract] Detected PDF format');
        textContent = await this.extractFromPdf(fileBuffer, keyword);
      } else if (fileName.endsWith('.docx')) {
        this.logger.log('[DocumentExtract] Detected Word format (.docx)');
        textContent = await this.extractFromWord(fileBuffer, keyword);
      } else if (fileName.endsWith('.doc')) {
        this.logger.log('[DocumentExtract] Detected Word format (.doc), using AI plugin');
        textContent = await this.extractFromDocWithPlugin(fileBuffer, file.originalname, keyword);
      } else {
        throw new Error('不支持的文件格式，请上传 PDF 或 Word (.doc/.docx) 文档');
      }

      this.logger.log(`[DocumentExtract] Extracted text length: ${textContent.length} chars`);
      
      if (textContent.length === 0) {
        throw new Error('No text content found in document');
      }

      const result = await this.parseFoodInfo(textContent);
      this.logger.log('[DocumentExtract] Successfully parsed food info:', JSON.stringify(result));
      return {
        rawText: textContent,
        parsed: result,
      };
    } catch (error) {
      this.logger.error('[DocumentExtract] Failed to extract document', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * Parse PDF document using pdf-parse
   */
  private async extractFromPdf(buffer: Buffer, keyword?: string): Promise<string> {
    try {
      // 验证 Buffer 是否为空或过小
      if (!buffer || buffer.length < 100) {
        throw new Error(`PDF buffer invalid: length=${buffer?.length}`);
      }
      
      // 验证 PDF 文件头 (%PDF-)
      const header = buffer.slice(0, 5).toString('ascii');
      if (!header.startsWith('%PDF-')) {
        throw new Error(`Invalid PDF header: ${header} (expected %PDF-)`);
      }
      
      this.logger.log(`[PDF Parse] Starting parse, buffer size: ${buffer.length}, header: ${header}`);
      
      const data = await new PDFParseClass({ data: buffer });
      const text = await data.getText();
      
      this.logger.log(`[PDF Parse] Parsed successfully, extracted text length: ${text?.length || 0}`);
      
      let resultText = text || '';
      if (keyword) {
        resultText = this.filterTextByKeyword(resultText, keyword);
      }
      return resultText;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`[PDF Parse] Failed to parse PDF: ${errorMsg}`, error);
      throw new Error(`PDF 解析失败: ${errorMsg}`);
    }
  }

  /**
   * Parse Word document using mammoth
   */
  private async extractFromWord(buffer: Buffer, keyword?: string): Promise<string> {
    try {
      const result = await mammoth.extractRawText({ buffer });
      let text = result.value;
      if (keyword) {
        text = this.filterTextByKeyword(text, keyword);
      }
      return text;
    } catch (error) {
      this.logger.error('Word document parsing failed', error);
      throw new Error('Failed to parse Word document');
    }
  }

  /**
   * .doc（旧版 Word）解析需要专用组件，本项目不内置任何付费文档插件。
   * 请先将 .doc 另存为 .docx 后上传；.docx / PDF 均由本地库直接解析。
   */
  private async extractFromDocWithPlugin(
    buffer: Buffer,
    fileName: string,
    keyword?: string,
  ): Promise<string> {
    throw new Error('暂不支持 .doc 格式，请另存为 .docx 后上传');
  }

  /**
   * Filter text to only include paragraphs containing the keyword
   */
  private filterTextByKeyword(text: string, keyword: string): string {
    const lines = text.split(/\r?\n/);
    const filtered = lines.filter((line) =>
      line.trim() && line.toLowerCase().includes(keyword.toLowerCase())
    );
    return filtered.join('\n');
  }

  /**
   * Parse extracted text to extract food information using AI plugin (multi-entity)
   */
  private async parseFoodInfo(text: string): Promise<any> {
    try {
      // 自带 OCR：调用使用者自己的文本模型（见 server/ocr-provider.js）
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { callOcr } = require('../../ocr-provider');
      const rawResult = await callOcr([
        {
          role: 'user',
          content: `请从下面的食品标签文本中提取结构化信息，只输出 JSON。
字段：manufacturerInfo(rawMaterialSupplier/delegator/entrustedParty)、foodList(含 name/ingredients/nutrition/netContent 等)。
文本：\n${text.slice(0, 60000)}`,
        },
      ]);
      if (!rawResult || !Array.isArray(rawResult.foodList)) {
        return this.parseFoodInfoFallback(text);
      }
      return rawResult;
    } catch (error) {
      this.logger.warn('[AIExtract] 自带 OCR 未配置或失败，改用正则兜底', error instanceof Error ? error.message : String(error));
      return this.parseFoodInfoFallback(text);
    }
  }

  /**
   * Fallback: Parse extracted text using regex to extract food information
   * Returns multi-entity format to match AI plugin output
   */
  private parseFoodInfoFallback(text: string): any {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

    // Extract food name (usually appears first or with "产品名称" label)
    let name = this.extractField(lines, ['产品名称', '食品名称', '名称', '品名']) || '未知食品';

    // Extract food type
    let type = this.extractField(lines, ['产品类型', '食品类型', '类型', '品类']) || '预包装食品';

    // Extract ingredients
    let ingredients = this.extractField(lines, ['配料', '配料表', '成分', '原料']) || '';

    // Extract nutrition information
    let nutrition = this.extractField(lines, ['营养成分', '营养成分表', '营养表']) || '';

    // Extract net content
    let netContent = this.extractField(lines, ['净含量', '净重', '规格']) || '';

    // Extract production date
    let productionDate = this.extractField(lines, ['生产日期', '生产时间']) || '';

    // Extract shelf life
    let shelfLife = this.extractField(lines, ['保质期', '有效期', '保存期限']) || '';

    // Extract storage condition
    let storageCondition = this.extractField(lines, ['贮存条件', '储存条件', '保存条件', '存储条件']) || '';

    // Extract standard code
    let standardCode = this.extractField(lines, ['产品标准', '执行标准', '标准代号', '标准号']) || '';

    // Extract allergens
    let allergens = this.extractAllergens(text);

    // Extract tips
    let tips = this.extractField(lines, ['温馨提示', '注意', '警示', '提醒']) || '';

    // Return multi-entity format to match AI plugin output
    return {
      manufacturerInfo: {
        rawMaterialSupplier: { name: '', address: '', phone: '', license: '', origin: '' },
        delegator: { name: '', address: '', phone: '' },
        entrustedParty: { name: '', address: '', phone: '', license: '', origin: '' },
      },
      foodList: [{
        id: 1,
        title: name,
        name,
        type,
        ingredients,
        netContent,
        allergens,
        tips,
      }],
    };
  }

  /**
   * Extract a field value from text lines
   */
  private extractField(lines: string[], keywords: string[]): string {
    for (const line of lines) {
      for (const keyword of keywords) {
        if (line.includes(keyword)) {
          // Try to extract value after colon or equals
          const parts = line.split(/[：:]/);
          if (parts.length > 1) {
            return parts.slice(1).join('：').trim();
          }
          // If no colon, try to remove the keyword
          const value = line.replace(keyword, '').trim();
          if (value && value !== line) {
            return value;
          }
        }
      }
    }
    return '';
  }

  /**
   * Extract allergen information from text
   */
  private extractAllergens(text: string): string[] {
    const allergenKeywords = [
      '麸质', '小麦', '大麦', '燕麦', '黑麦',
      '甲壳类', '虾', '蟹', '龙虾',
      '蛋类', '鸡蛋', '蛋黄', '蛋白',
      '鱼类', '鳕鱼', '三文鱼', '金枪鱼',
      '花生', '大豆', '牛奶', '乳制品', '乳糖',
      '坚果', '杏仁', '核桃', '榛子', '腰果',
      '芝麻', '芹菜', '芥末', '二氧化硫', '亚硫酸盐',
    ];

    const foundAllergens: string[] = [];
    const textLower = text.toLowerCase();

    for (const allergen of allergenKeywords) {
      if (textLower.includes(allergen.toLowerCase())) {
        foundAllergens.push(allergen);
      }
    }

    return foundAllergens;
  }

  /**
   * Create a new record for document extraction
   */
  async createExtractRecord(
    fileName: string,
    manufacturerInfo: ManufacturerInfo,
    foodInfo: FoodInfo,
    isMultiFood?: boolean,
    foodList?: FoodInfoItem[],
    manufacturerList?: ManufacturerInfo[],
    rawMaterialSupplierList?: ManufacturerInfo['rawMaterialSupplier'][],
    delegatorList?: ManufacturerInfo['delegator'][],
    entrustedPartyList?: ManufacturerInfo['entrustedParty'][],
  ): Promise<string> {
    try {
      const rawData: any = { manufacturerInfo, foodInfo };
      if (isMultiFood) rawData.isMultiFood = isMultiFood;
      if (foodList) rawData.foodList = foodList;
      if (manufacturerList) rawData.manufacturerList = manufacturerList;
      if (rawMaterialSupplierList) rawData.rawMaterialSupplierList = rawMaterialSupplierList;
      if (delegatorList) rawData.delegatorList = delegatorList;
      if (entrustedPartyList) rawData.entrustedPartyList = entrustedPartyList;
      
      const result = await this.db.insert(record).values({
        type: 'generate',
        fileName,
        status: 'success',
        rawData,
      }).returning({ id: record.id });

      return result[0].id;
    } catch (error) {
      this.logger.error('Failed to create extract record', error);
      throw error;
    }
  }

  /**
   * Save generate data to record table
   */
  async saveGenerateData(
    recordId: string,
    manufacturerInfo: ManufacturerInfo,
    foodInfo: FoodInfo,
    isMultiFood?: boolean,
    foodList?: FoodInfoItem[],
    manufacturerList?: ManufacturerInfo[],
    rawMaterialSupplierList?: ManufacturerInfo['rawMaterialSupplier'][],
    delegatorList?: ManufacturerInfo['delegator'][],
    entrustedPartyList?: ManufacturerInfo['entrustedParty'][],
  ): Promise<void> {
    try {
      const rawData: any = { manufacturerInfo, foodInfo };
      if (isMultiFood) rawData.isMultiFood = isMultiFood;
      if (foodList) rawData.foodList = foodList;
      if (manufacturerList) rawData.manufacturerList = manufacturerList;
      if (rawMaterialSupplierList) rawData.rawMaterialSupplierList = rawMaterialSupplierList;
      if (delegatorList) rawData.delegatorList = delegatorList;
      if (entrustedPartyList) rawData.entrustedPartyList = entrustedPartyList;
      
      await this.db
        .update(record)
        .set({
          rawData,
          status: 'success',
        })
        .where(eq(record.id, recordId));

      this.logger.log(`Saved generate data for record ${recordId}`);
    } catch (error) {
      this.logger.error('Failed to save generate data', error);
      throw error;
    }
  }

  /**
   * Build food label HTML based on manufacturer and food information
   */
  async buildLabel(recordId: string, layout?: string): Promise<{ labelHtml: string; labelPreview: string }> {
    try {
      // Fetch record data
      const results = await this.db
        .select()
        .from(record)
        .where(eq(record.id, recordId));

      if (results.length === 0) {
        throw new Error('Record not found');
      }

      const recordData = results[0];
      const rawData = recordData.rawData as {
        manufacturerInfo?: ManufacturerInfo;
        foodInfo?: FoodInfo;
      };

      if (!rawData.manufacturerInfo || !rawData.foodInfo) {
        throw new Error('Missing manufacturer or food information');
      }

      const { manufacturerInfo, foodInfo } = rawData;

      // Generate label HTML
      const labelHtml = this.generateLabelHtml(manufacturerInfo, foodInfo, layout);

      // Update record with label data
      await this.db
        .update(record)
        .set({
          resultData: {
            labelHtml,
            labelPreview: labelHtml, // In real scenario, this would be a rendered image URL
          },
        })
        .where(eq(record.id, recordId));

      return {
        labelHtml,
        labelPreview: labelHtml,
      };
    } catch (error) {
      this.logger.error('Failed to build label', error);
      throw error;
    }
  }

  /**
   * Generate label HTML content
   */
  private generateLabelHtml(
    manufacturerInfo: ManufacturerInfo,
    foodInfo: FoodInfo,
    layout?: string,
  ): string {
    const { rawMaterialSupplier, delegator, entrustedParty } = manufacturerInfo;
    const allergenWarning = foodInfo.allergens.length > 0
      ? `致敏物质提示：${foodInfo.allergens.join('、')}`
      : '';

    return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: "Source Han Sans SC", "Noto Sans SC", -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 12px;
      line-height: 1.6;
      color: #1a1a1a;
      padding: 20mm;
      max-width: 100mm;
    }
    .label-container {
      border: 1px solid #ddd;
      padding: 15px;
    }
    .section {
      margin-bottom: 12px;
    }
    .section-title {
      font-weight: bold;
      font-size: 14px;
      color: #2563eb;
      border-bottom: 1px solid #2563eb;
      padding-bottom: 4px;
      margin-bottom: 6px;
    }
    .info-row {
      display: flex;
      margin-bottom: 4px;
    }
    .info-label {
      font-weight: 500;
      min-width: 80px;
      color: #666;
    }
    .info-value {
      flex: 1;
    }
    .food-name {
      font-size: 18px;
      font-weight: bold;
      text-align: center;
      margin-bottom: 15px;
      color: #1a1a1a;
    }
    .nutrition-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
    }
    .nutrition-table th,
    .nutrition-table td {
      border: 1px solid #ddd;
      padding: 4px 6px;
      text-align: left;
    }
    .nutrition-table th {
      background: #f5f5f5;
    }
    .allergen-warning {
      background: #fef3c7;
      padding: 8px;
      border-radius: 4px;
      font-size: 11px;
      color: #92400e;
      margin-top: 10px;
    }
  </style>
</head>
<body>
  <div class="label-container">
    <!-- Food Name -->
    <div class="food-name">${foodInfo.name}</div>

    <!-- Raw Material Supplier -->
    <div class="section">
      <div class="section-title">原料生产商信息</div>
      <div class="info-row">
        <span class="info-label">名称：</span>
        <span class="info-value">${rawMaterialSupplier.name}</span>
      </div>
      <div class="info-row">
        <span class="info-label">地址：</span>
        <span class="info-value">${rawMaterialSupplier.address}</span>
      </div>
      ${rawMaterialSupplier.phone ? `
      <div class="info-row">
        <span class="info-label">电话：</span>
        <span class="info-value">${rawMaterialSupplier.phone}</span>
      </div>
      ` : ''}
      ${rawMaterialSupplier.license ? `
      <div class="info-row">
        <span class="info-label">许可证：</span>
        <span class="info-value">${rawMaterialSupplier.license}</span>
      </div>
      ` : ''}
    </div>

    <!-- Delegator (Distributor) -->
    <div class="section">
      <div class="section-title">委托方（经销商）</div>
      <div class="info-row">
        <span class="info-label">名称：</span>
        <span class="info-value">${delegator.name}</span>
      </div>
      <div class="info-row">
        <span class="info-label">地址：</span>
        <span class="info-value">${delegator.address}</span>
      </div>
      <div class="info-row">
        <span class="info-label">电话：</span>
        <span class="info-value">${delegator.phone}</span>
      </div>
    </div>

    <!-- Entrusted Party (Packaging Factory) -->
    <div class="section">
      <div class="section-title">被委托方（分装厂）</div>
      <div class="info-row">
        <span class="info-label">名称：</span>
        <span class="info-value">${entrustedParty.name}</span>
      </div>
      <div class="info-row">
        <span class="info-label">地址：</span>
        <span class="info-value">${entrustedParty.address}</span>
      </div>
      <div class="info-row">
        <span class="info-label">许可证：</span>
        <span class="info-value">${entrustedParty.license}</span>
      </div>
    </div>

    <!-- Food Details -->
    <div class="section">
      <div class="section-title">食品信息</div>
      <div class="info-row">
        <span class="info-label">净含量：</span>
        <span class="info-value">${foodInfo.netContent}</span>
      </div>
      <div class="info-row">
        <span class="info-label">配料表：</span>
        <span class="info-value">${foodInfo.ingredients}</span>
      </div>
      ${foodInfo.productionDate ? `
      <div class="info-row">
        <span class="info-label">生产日期：</span>
        <span class="info-value">${foodInfo.productionDate}</span>
      </div>
      ` : ''}
      <div class="info-row">
        <span class="info-label">保质期：</span>
        <span class="info-value">${foodInfo.shelfLife}</span>
      </div>
      <div class="info-row">
        <span class="info-label">贮存条件：</span>
        <span class="info-value">${foodInfo.storageCondition}</span>
      </div>
    </div>

    <!-- Nutrition Facts -->
    ${foodInfo.nutrition ? `
    <div class="section">
      <div class="section-title">营养成分表</div>
      <pre style="white-space: pre-wrap; font-size: 11px;">${foodInfo.nutrition}</pre>
    </div>
    ` : ''}

    <!-- Allergen Warning -->
    ${allergenWarning ? `
    <div class="allergen-warning">
      ⚠️ ${allergenWarning}
    </div>
    ` : ''}
  </div>
</body>
</html>`;
  }

  /**
   * Export label as Word format
   */
  async exportLabel(recordId: string): Promise<Buffer> {
    try {
      // Fetch record data
      const results = await this.db
        .select()
        .from(record)
        .where(eq(record.id, recordId));

      if (results.length === 0) {
        throw new Error('Record not found');
      }

      const recordData = results[0];
      const rawData = recordData.rawData as {
        manufacturerInfo?: ManufacturerInfo;
        foodInfo?: FoodInfo;
        foodList?: FoodInfoItem[];
        isMultiFood?: boolean;
      };

      if (!rawData.manufacturerInfo) {
        throw new Error('Missing manufacturer information');
      }

      const { manufacturerInfo } = rawData;

      // Generate Word document content
      let wordContent: Buffer;
      if (rawData.isMultiFood && rawData.foodList && rawData.foodList.length > 0) {
        wordContent = this.generateMultiFoodWordContent(manufacturerInfo, rawData.foodList);
      } else if (rawData.foodInfo) {
        wordContent = this.generateWordContent(manufacturerInfo, rawData.foodInfo);
      } else {
        throw new Error('Missing food information');
      }

      // Update record with export URL
      // Note: In production, this would upload to file storage and return a URL
      await this.db
        .update(record)
        .set({
          exportUrl: `/api/generate/${recordId}/export`,
        })
        .where(eq(record.id, recordId));

      return wordContent;
    } catch (error) {
      this.logger.error('Failed to export label', error);
      throw error;
    }
  }

  /**
   * Generate Word document content as HTML (can be converted to .docx)
   */
  private generateWordContent(
    manufacturerInfo: ManufacturerInfo,
    foodInfo: FoodInfo,
  ): Buffer {
    const { rawMaterialSupplier, delegator, entrustedParty } = manufacturerInfo;
    const allergenWarning = foodInfo.allergens.length > 0
      ? `致敏物质提示：${foodInfo.allergens.join('、')}`
      : '';

    const htmlContent = `
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta charset="UTF-8">
  <meta name=ProgId content=Word.Document>
  <meta name=Generator content="Microsoft Word 15">
  <style>
    body { font-family: "Source Han Sans SC", "SimSun", sans-serif; font-size: 12pt; }
    .food-name { font-size: 18pt; font-weight: bold; text-align: center; margin: 20pt 0; }
    .section { margin: 15pt 0; }
    .section-title { font-size: 14pt; font-weight: bold; color: #2563eb; border-bottom: 1pt solid #2563eb; }
    .info-row { margin: 5pt 0; }
    .info-label { font-weight: bold; }
    .allergen-warning { background: #fef3c7; padding: 10pt; color: #92400e; }
  </style>
</head>
<body>
  <div class="food-name">${foodInfo.name}</div>

  <div class="section">
    <div class="section-title">厂商信息</div>
    <div class="info-row"><span class="info-label">原料生产商：</span>${rawMaterialSupplier.name}</div>
    <div class="info-row"><span class="info-label">地址：</span>${rawMaterialSupplier.address}</div>
    ${rawMaterialSupplier.phone ? `<div class="info-row"><span class="info-label">电话：</span>${rawMaterialSupplier.phone}</div>` : ''}
    ${rawMaterialSupplier.license ? `<div class="info-row"><span class="info-label">许可证：</span>${rawMaterialSupplier.license}</div>` : ''}
    <div class="info-row"><span class="info-label">委托方：</span>${delegator.name}</div>
    <div class="info-row"><span class="info-label">地址：</span>${delegator.address}</div>
    <div class="info-row"><span class="info-label">电话：</span>${delegator.phone}</div>
    <div class="info-row"><span class="info-label">被委托方：</span>${entrustedParty.name}</div>
    <div class="info-row"><span class="info-label">地址：</span>${entrustedParty.address}</div>
    <div class="info-row"><span class="info-label">许可证：</span>${entrustedParty.license}</div>
  </div>

  <div class="section">
    <div class="section-title">食品信息</div>
    <div class="info-row"><span class="info-label">净含量：</span>${foodInfo.netContent}</div>
    <div class="info-row"><span class="info-label">配料表：</span>${foodInfo.ingredients}</div>
    ${foodInfo.productionDate ? `<div class="info-row"><span class="info-label">生产日期：</span>${foodInfo.productionDate}</div>` : ''}
    <div class="info-row"><span class="info-label">保质期：</span>${foodInfo.shelfLife}</div>
    <div class="info-row"><span class="info-label">贮存条件：</span>${foodInfo.storageCondition}</div>
  </div>

  <div class="section">
    <div class="section-title">质量信息</div>
    <div class="info-row"><span class="info-label">产品标准代号：</span>${foodInfo.standardCode}</div>
  </div>

  ${foodInfo.nutrition ? `
  <div class="section">
    <div class="section-title">营养成分表</div>
    <pre>${foodInfo.nutrition}</pre>
  </div>
  ` : ''}

  ${allergenWarning ? `<div class="allergen-warning">⚠️ ${allergenWarning}</div>` : ''}
</body>
</html>`;

    return Buffer.from(htmlContent, 'utf-8');
  }

  /**
   * Generate Word document content for multiple foods
   * Manufacturer info is shown once, each food has its own section
   */
  private generateMultiFoodWordContent(
    manufacturerInfo: ManufacturerInfo,
    foodList: FoodInfoItem[],
  ): Buffer {
    const { rawMaterialSupplier, delegator, entrustedParty } = manufacturerInfo;

    // Build manufacturer section (shown once)
    const manufacturerSection = `
  <div class="section">
    <div class="section-title">厂商信息</div>
    <div class="info-row"><span class="info-label">原料生产商：</span>${rawMaterialSupplier.name}</div>
    <div class="info-row"><span class="info-label">地址：</span>${rawMaterialSupplier.address}</div>
    ${rawMaterialSupplier.phone ? `<div class="info-row"><span class="info-label">电话：</span>${rawMaterialSupplier.phone}</div>` : ''}
    ${rawMaterialSupplier.license ? `<div class="info-row"><span class="info-label">许可证：</span>${rawMaterialSupplier.license}</div>` : ''}
    <div class="info-row"><span class="info-label">委托方：</span>${delegator.name}</div>
    <div class="info-row"><span class="info-label">地址：</span>${delegator.address}</div>
    <div class="info-row"><span class="info-label">电话：</span>${delegator.phone}</div>
    <div class="info-row"><span class="info-label">被委托方：</span>${entrustedParty.name}</div>
    <div class="info-row"><span class="info-label">地址：</span>${entrustedParty.address}</div>
    <div class="info-row"><span class="info-label">许可证：</span>${entrustedParty.license}</div>
  </div>`;

    // Build food sections (one per food)
    const foodSections = foodList.map((food, index) => {
      const title = food.title || `食品信息 ${index + 1}`;
      const allergenWarning = food.allergens.length > 0
        ? `<div class="allergen-warning">⚠️ 致敏物质提示：${food.allergens.join('、')}</div>`
        : '';

      return `
  <div class="section">
    <div class="section-title">${title}</div>
    <div class="food-name">${food.name}</div>
    <div class="info-row"><span class="info-label">净含量：</span>${food.netContent}</div>
    <div class="info-row"><span class="info-label">配料表：</span>${food.ingredients}</div>
    ${food.productionDate ? `<div class="info-row"><span class="info-label">生产日期：</span>${food.productionDate}</div>` : ''}
    <div class="info-row"><span class="info-label">保质期：</span>${food.shelfLife}</div>
    <div class="info-row"><span class="info-label">贮存条件：</span>${food.storageCondition}</div>
    <div class="info-row"><span class="info-label">产品标准代号：</span>${food.standardCode}</div>
    ${food.nutrition ? `
    <div class="info-row" style="margin-top: 8pt;"><span class="info-label">营养成分表：</span></div>
    <pre>${food.nutrition}</pre>
    ` : ''}
    ${allergenWarning}
  </div>`;
    }).join('\n');

    const htmlContent = `
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta charset="UTF-8">
  <meta name=ProgId content=Word.Document>
  <meta name=Generator content="Microsoft Word 15">
  <style>
    body { font-family: "Source Han Sans SC", "SimSun", sans-serif; font-size: 12pt; }
    .food-name { font-size: 16pt; font-weight: bold; text-align: center; margin: 15pt 0 10pt; }
    .section { margin: 15pt 0; page-break-inside: avoid; }
    .section-title { font-size: 14pt; font-weight: bold; color: #2563eb; border-bottom: 1pt solid #2563eb; }
    .info-row { margin: 5pt 0; }
    .info-label { font-weight: bold; }
    .allergen-warning { background: #fef3c7; padding: 10pt; color: #92400e; margin-top: 8pt; }
  </style>
</head>
<body>
${manufacturerSection}
${foodSections}
</body>
</html>`;

    return Buffer.from(htmlContent, 'utf-8');
  }
}
