import { Module } from '@nestjs/common';
import { PrismaModule } from '@database/prisma/prisma.module';
import { SchemaManagerModule } from '@database/schema-manager/schema-manager.module';
import { RuntimeConfigModule } from '@modules/runtime-config/runtime-config.module';
import { RequestContextModule } from '@database/schema-manager/request-context';
import { ClassSessionRecordsService } from './class-session-records.service';
import { SessionJournalService } from './session-journal.service';
import { SessionFollowupService } from './session-followup.service';
import { SessionReportsService } from './session-reports.service';
import { ClassSessionRecordsController } from './class-session-records.controller';

@Module({
  imports: [
    PrismaModule,
    SchemaManagerModule,
    RuntimeConfigModule,
    RequestContextModule,
  ],
  controllers: [ClassSessionRecordsController],
  providers: [
    ClassSessionRecordsService,
    SessionJournalService,
    SessionFollowupService,
    SessionReportsService,
  ],
  exports: [ClassSessionRecordsService],
})
export class ClassSessionRecordsModule {}
