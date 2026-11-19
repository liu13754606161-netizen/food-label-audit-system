import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuditService } from './audit.service';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import {
  type OcrReq,
  type OcrResp,
  type SaveAuditReq,
  type SaveAuditResp,
  type VerifyReq,
  type VerifyResp,
  type ImageDocumentCompareReq,
  type ImageDocumentCompareResp,
} from '@shared/api.interface';

@Controller('api/audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Post('ocr')
  @NeedLogin()
  async ocrRecognize(
    @Req() _req: Request,
    @Body() body: OcrReq,
  ): Promise<OcrResp> {
    const result = await this.auditService.ocrRecognize(body.imageBase64, body.fileName);

    return {
      recordId: result.recordId,
      manufacturerInfo: result.manufacturerInfo,
      foodInfo: result.foodInfo,
      rawText: result.rawText,
      isMultiFood: result.isMultiFood,
      foodList: result.foodList,
    };
  }

  @Post('compare-file')
  @NeedLogin()
  async compareImageWithDocument(
    @Req() _req: Request,
    @Body() body: ImageDocumentCompareReq,
  ): Promise<ImageDocumentCompareResp> {
    const pureBase64Data = body.fileData.replace(/^data:.*?;base64,/, '');
    const fileBuffer = Buffer.from(pureBase64Data, 'base64');

    if (!fileBuffer.length) {
      throw new Error('上传文件内容为空');
    }

    const file = {
      buffer: fileBuffer,
      originalname: body.fileName,
      mimetype: body.fileType,
      size: fileBuffer.length,
    };

    return this.auditService.compareImageWithDocument({
      foodImageBase64: body.foodImageBase64,
      foodImageFileName: body.foodImageFileName,
      nutritionImageBase64: body.nutritionImageBase64,
      nutritionImageFileName: body.nutritionImageFileName,
      file,
    });
  }

  @Post('save')
  @NeedLogin()
  async saveAuditData(
    @Req() _req: Request,
    @Body() body: SaveAuditReq,
  ): Promise<SaveAuditResp> {
    const { recordId, manufacturerInfo, foodInfo } = body;

    await this.auditService.updateRecord(recordId, {
      rawData: { manufacturerInfo, foodInfo },
    });

    return {
      success: true,
      recordId,
    };
  }

  @Post('verify')
  @NeedLogin()
  async verifyLabel(
    @Req() _req: Request,
    @Body() body: VerifyReq,
  ): Promise<VerifyResp> {
    const { recordId, useCustomStandard } = body;

    const result = await this.auditService.verifyLabel(recordId, useCustomStandard);

    return {
      success: result.success,
      result: result.result,
    };
  }

  @Get(':id/export')
  @NeedLogin()
  async exportAuditReport(
    @Req() _req: Request,
    @Param('id') recordId: string,
    @Res() res: Response,
  ): Promise<void> {
    const docxBuffer = await this.auditService.exportAuditReport(recordId);

    const recordData = await this.auditService.getRecordById(recordId);
    const fileName = `审核报告_${recordData.fileName.replace(/\.[^.]+$/, '')}.docx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.send(docxBuffer);
  }

  @Get(':id')
  @NeedLogin()
  async getRecordDetail(
    @Req() _req: Request,
    @Param('id') recordId: string,
  ) {
    return this.auditService.getRecordById(recordId);
  }
}
