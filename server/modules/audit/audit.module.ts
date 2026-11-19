import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { GenerateService } from '../generate/generate.service';

@Module({
  imports: [HttpModule],
  controllers: [AuditController],
  providers: [AuditService, GenerateService],
})
export class AuditModule {}
