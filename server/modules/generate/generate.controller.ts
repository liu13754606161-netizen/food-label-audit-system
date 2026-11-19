import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Res,
  HttpException,
  HttpStatus,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { GenerateService } from './generate.service';
import type {
  ExtractResp,
  SaveGenerateReq,
  SaveGenerateResp,
  BuildLabelReq,
  BuildLabelResp,
} from '@shared/api.interface';

// 文件上传 DTO
interface ExtractDocumentDto {
  fileName: string;
  fileType: string;
  fileData: string; // Base64 encoded (可能包含 data:... 前缀)
  keyword?: string;
}

// 模拟 Multer File 对象，用于传递给 Service
interface MockMulterFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

@Controller('api/generate')
export class GenerateController {
  private readonly logger = new Logger(GenerateController.name);

  constructor(private readonly generateService: GenerateService) {}

  /**
   * Upload PDF/Word document to extract food information
   * 使用 Base64 编码传输文件，绕过 multipart 解析问题
   */
  @Post('extract')
  async extractDocument(
    @Body() dto: ExtractDocumentDto,
  ): Promise<ExtractResp> {
    if (!dto.fileData || !dto.fileName) {
      throw new BadRequestException('未检测到上传的文件');
    }

    // Validate file type
    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
    ];
    const allowedExtensions = ['.pdf', '.docx', '.doc'];

    const fileName = dto.fileName.toLowerCase();
    const hasValidExtension = allowedExtensions.some((ext) =>
      fileName.endsWith(ext),
    );

    if (!allowedTypes.includes(dto.fileType) && !hasValidExtension) {
      throw new BadRequestException(
        'Invalid file format. Please upload PDF or Word documents (.pdf, .docx, .doc)'
      );
    }

    try {
      // 强制清理 Base64 Data URI 前缀（如 data:application/pdf;base64,）
      const pureBase64Data = dto.fileData.replace(/^data:.*?;base64,/, '');
      
      // 将 Base64 转换为 Buffer
      const fileBuffer = Buffer.from(pureBase64Data, 'base64');
      
      if (fileBuffer.length === 0) {
        this.logger.error('Base64 解码后文件为空，输入长度:', dto.fileData.length);
        throw new BadRequestException('文件内容为空或 Base64 解码失败');
      }
      
      this.logger.log(`文件转换成功: ${dto.fileName}, 大小: ${fileBuffer.length} bytes`);
      
      // 构造兼容 multer 的文件对象 - 确保属性完整
      const file: MockMulterFile = {
        buffer: fileBuffer,
        originalname: dto.fileName,
        mimetype: dto.fileType,
        size: fileBuffer.length,
      };

      const extractResult = await this.generateService.extractFromDocument(file, dto.keyword);

      // extractResult 是多实体格式: { manufacturerInfo, foodList }
      const manufacturerInfo = extractResult.manufacturerInfo || {
        rawMaterialSupplier: { name: '', address: '', phone: '', license: '', origin: '' },
        delegator: { name: '', address: '', phone: '' },
        entrustedParty: { name: '', address: '', phone: '', license: '', origin: '' },
      };
      const foodList = extractResult.foodList || [];

      // Create a new record for this extraction
      const recordId = await this.generateService.createExtractRecord(
        dto.fileName,
        manufacturerInfo,
        foodList[0] || {},
      );

      return {
        recordId,
        manufacturerInfo,
        foodList,
      };
    } catch (error) {
      // 记录完整错误信息
      const errorStack = error instanceof Error ? error.stack : String(error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`文件处理失败: ${errorMessage}`, errorStack);
      
      // 将真实的错误信息返回给前端，包含堆栈便于调试
      throw new HttpException(
        {
          message: `文档提取失败详请: ${errorMessage}`,
          stack: errorStack,
          timestamp: new Date().toISOString(),
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Save filled manufacturer and food information
   * If recordId is not provided, a new record will be created
   */
  @Post('save')
  async saveGenerateData(
    @Body() body: SaveGenerateReq,
  ): Promise<SaveGenerateResp> {
    const { recordId, manufacturerInfo, foodInfo, isMultiFood, foodList, manufacturerList, rawMaterialSupplierList, delegatorList, entrustedPartyList } = body;

    if (!manufacturerInfo || !foodInfo) {
      throw new BadRequestException('Manufacturer and food information are required');
    }

    let finalRecordId = recordId;

    if (!finalRecordId) {
      // Create a new record if recordId is not provided
      finalRecordId = await this.generateService.createExtractRecord(
        foodInfo.name || '未命名',
        manufacturerInfo,
        foodInfo,
        isMultiFood,
        foodList,
        manufacturerList,
        rawMaterialSupplierList,
        delegatorList,
        entrustedPartyList,
      );
    } else {
      // Update existing record
      await this.generateService.saveGenerateData(finalRecordId, manufacturerInfo, foodInfo, isMultiFood, foodList, manufacturerList, rawMaterialSupplierList, delegatorList, entrustedPartyList);
    }

    return {
      success: true,
      recordId: finalRecordId,
    };
  }

  /**
   * Generate food label
   */
  @Post('build')
  async buildLabel(@Body() body: BuildLabelReq): Promise<BuildLabelResp> {
    const { recordId, layout } = body;

    if (!recordId) {
      throw new BadRequestException('Record ID is required');
    }

    const { labelPreview } = await this.generateService.buildLabel(recordId, layout);

    return {
      success: true,
      labelPreview,
      recordId,
    };
  }

  /**
   * Export label as Word format
   */
  @Get(':id/export')
  async exportLabel(
    @Param('id') recordId: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!recordId) {
      throw new BadRequestException('Record ID is required');
    }

    const wordBuffer = await this.generateService.exportLabel(recordId);

    // Set response headers for Word document download
    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="food-label-${recordId}.doc"`,
      'Content-Length': wordBuffer.length,
    });

    res.end(wordBuffer);
  }
}
