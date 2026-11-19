import { Injectable, Inject, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { record } from '@server/database/schema';
import {
  eq,
  and,
  count,
  desc,
  gte,
  lte,
  sql,
} from 'drizzle-orm';
import type {
  RecordItem,
  RecordListParams,
  RecordListResp,
  RecentRecordsResp,
  RecordDetailResp,
  UpdateRecordReq,
} from '@shared/api.interface';

@Injectable()
export class RecordService {
  private readonly logger = new Logger(RecordService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  async getRecords(params: RecordListParams): Promise<RecordListResp> {
    const { type, page = 1, pageSize = 10, startDate, endDate } = params;

    const conditions = [];

    if (type) {
      conditions.push(eq(record.type, type));
    }

    if (startDate) {
      conditions.push(gte(record.createdAt, new Date(startDate)));
    }

    if (endDate) {
      conditions.push(lte(record.createdAt, new Date(endDate)));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const totalResult = await this.db
      .select({ count: count() })
      .from(record)
      .where(whereClause);

    const total = totalResult[0]?.count ?? 0;

    const offset = (page - 1) * pageSize;

    const records = await this.db
      .select()
      .from(record)
      .where(whereClause)
      .orderBy(desc(record.createdAt))
      .limit(pageSize)
      .offset(offset);

    const items: RecordItem[] = records.map((r) => ({
      id: r.id,
      type: r.type as RecordItem['type'],
      fileName: r.fileName,
      status: r.status as RecordItem['status'],
      rawData: r.rawData as RecordItem['rawData'],
      resultData: r.resultData as RecordItem['resultData'],
      customStandardUrl: r.customStandardUrl ?? undefined,
      exportUrl: r.exportUrl ?? undefined,
      createdAt: r.createdAt.toISOString(),
    }));

    return {
      items,
      total,
      page,
      pageSize,
    };
  }

  async getRecentRecords(): Promise<RecentRecordsResp> {
    const records = await this.db
      .select({
        id: record.id,
        type: record.type,
        fileName: record.fileName,
        status: record.status,
        createdAt: record.createdAt,
      })
      .from(record)
      .orderBy(desc(record.createdAt))
      .limit(5);

    const items = records.map((r) => ({
      id: r.id,
      type: r.type as RecentRecordsResp['items'][0]['type'],
      fileName: r.fileName,
      status: r.status as RecentRecordsResp['items'][0]['status'],
      createdAt: r.createdAt.toISOString(),
    }));

    return { items };
  }

  async getRecordById(id: string): Promise<RecordDetailResp | null> {
    const result = await this.db
      .select()
      .from(record)
      .where(eq(record.id, id))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    const r = result[0];
    return {
      id: r.id,
      type: r.type as RecordItem['type'],
      fileName: r.fileName,
      status: r.status as RecordItem['status'],
      rawData: r.rawData as RecordItem['rawData'],
      resultData: r.resultData as RecordItem['resultData'],
      customStandardUrl: r.customStandardUrl ?? undefined,
      exportUrl: r.exportUrl ?? undefined,
      createdAt: r.createdAt.toISOString(),
    };
  }

  async updateRecord(id: string, data: UpdateRecordReq): Promise<{ success: boolean }> {
    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (data.rawData) {
      updateData.rawData = data.rawData;
    }

    if (data.resultData) {
      updateData.resultData = data.resultData;
    }

    await this.db
      .update(record)
      .set(updateData)
      .where(eq(record.id, id));

    return { success: true };
  }

  async exportRecord(id: string): Promise<Blob | null> {
    const result = await this.db
      .select({
        exportUrl: record.exportUrl,
        resultData: record.resultData,
        fileName: record.fileName,
      })
      .from(record)
      .where(eq(record.id, id))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    const recordData = result[0];

    if (recordData.exportUrl) {
      try {
        const response = await fetch(recordData.exportUrl);
        if (!response.ok) {
          this.logger.error(`Failed to fetch export file: ${response.statusText}`);
          return null;
        }
        const arrayBuffer = await response.arrayBuffer();
        return new Blob([arrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      } catch (error) {
        this.logger.error('Failed to download export file', error);
        return null;
      }
    }

    return null;
  }

  async deleteRecord(id: string): Promise<{ success: boolean }> {
    await this.db
      .delete(record)
      .where(eq(record.id, id));

    return { success: true };
  }
}
