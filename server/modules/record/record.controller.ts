import { Controller, Get, Put, Delete, Param, Query, Body, Res, NotFoundException } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request, Response } from 'express';
import { RecordService } from './record.service';
import type {
  RecordListParams,
  RecordListResp,
  RecentRecordsResp,
  RecordDetailResp,
  UpdateRecordReq,
  UpdateRecordResp,
} from '@shared/api.interface';

@Controller('api/records')
export class RecordController {
  constructor(private readonly recordService: RecordService) {}

  @Get()
  async getRecords(
    @Query('type') type?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<RecordListResp> {
    const params: RecordListParams = {
      type: type as RecordListParams['type'],
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize, 10) : 10,
      startDate,
      endDate,
    };

    return this.recordService.getRecords(params);
  }

  @Get('recent')
  async getRecentRecords(): Promise<RecentRecordsResp> {
    return this.recordService.getRecentRecords();
  }

  @Get(':id')
  async getRecordById(@Param('id') id: string): Promise<RecordDetailResp> {
    const record = await this.recordService.getRecordById(id);

    if (!record) {
      throw new NotFoundException(`Record with id ${id} not found`);
    }

    return record;
  }

  @NeedLogin()
  @Put(':id')
  async updateRecord(
    @Param('id') id: string,
    @Body() data: UpdateRecordReq,
  ): Promise<UpdateRecordResp> {
    const existing = await this.recordService.getRecordById(id);

    if (!existing) {
      throw new NotFoundException(`Record with id ${id} not found`);
    }

    return this.recordService.updateRecord(id, data);
  }

  @Get(':id/export')
  async exportRecord(
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const blob = await this.recordService.exportRecord(id);

    if (!blob) {
      throw new NotFoundException(`Export file for record ${id} not found`);
    }

    const existing = await this.recordService.getRecordById(id);
    const fileName = existing?.fileName
      ? `${existing.fileName.replace(/\.[^.]+$/, '')}_export.docx`
      : `record_${id}_export.docx`;

    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
    });

    const buffer = await blob.arrayBuffer();
    res.end(Buffer.from(buffer));
  }

  @NeedLogin()
  @Delete(':id')
  async deleteRecord(@Param('id') id: string): Promise<{ success: boolean }> {
    const existing = await this.recordService.getRecordById(id);

    if (!existing) {
      throw new NotFoundException(`Record with id ${id} not found`);
    }

    return this.recordService.deleteRecord(id);
  }
}
