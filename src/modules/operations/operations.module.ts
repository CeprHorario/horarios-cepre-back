import { OperationsReportsController } from './operations-reports.controller';
import { Module } from '@nestjs/common';
import { AvailabilityWorkbook } from './availability-workbook.service';
import { AvailabilityWorkbookController } from './availability-workbook.controller';
import { ScheduleModule } from '../schedules/schedules.module';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '@database/prisma/prisma.module';
import { RequestContextModule } from '@database/schema-manager/request-context';
import { SchemaManagerModule } from '@database/schema-manager/schema-manager.module';
import { ClassSessionRecordsModule } from '../class-session-records/class-session-records.module';
import { OperationsContext } from './operations-context.service';
import { OperationsService } from './operations.service';
import { OperationsController } from './operations.controller';
import { RequestDocuments } from './request-document.service';
import { ClassSessionContextGuard } from '../class-session-records/class-session-context.guard';
@Module({
  imports: [
    PrismaModule,
    RequestContextModule,
    SchemaManagerModule,
    ClassSessionRecordsModule,
    ConfigModule,
    ScheduleModule,
  ],
  controllers: [
    OperationsController,
    AvailabilityWorkbookController,
    OperationsReportsController,
  ],
  providers: [
    OperationsContext,
    AvailabilityWorkbook,
    OperationsService,
    RequestDocuments,
    ClassSessionContextGuard,
  ],
  exports: [OperationsContext, OperationsService],
})
export class OperationsModule {}
