import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ClassSessionRecordsModule } from '../class-session-records/class-session-records.module';
import { SessionFilesController } from './session-files.controller';
import { SessionFilesService } from './session-files.service';
import { SessionObjectStorage } from './session-object-storage.service';

@Module({
  imports: [ConfigModule, ClassSessionRecordsModule],
  controllers: [SessionFilesController],
  providers: [SessionFilesService, SessionObjectStorage],
  exports: [SessionFilesService],
})
export class SessionFilesModule {}
