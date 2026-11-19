import { Module } from '@nestjs/common';
import { ClassSessionRecordsModule } from '../class-session-records/class-session-records.module';
import { IncidencesController } from './incidences.controller';
import { IncidencesService } from './incidences.service';
import { ClassSessionContextGuard } from '../class-session-records/class-session-context.guard';
import { OperationsModule } from '../operations/operations.module';
@Module({
  imports: [ClassSessionRecordsModule, OperationsModule],
  controllers: [IncidencesController],
  providers: [IncidencesService, ClassSessionContextGuard],
})
export class IncidencesModule {}
