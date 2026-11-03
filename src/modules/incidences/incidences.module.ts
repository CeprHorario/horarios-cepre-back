import { Module } from '@nestjs/common';
import { ClassSessionRecordsModule } from '../class-session-records/class-session-records.module';
import { IncidencesController } from './incidences.controller';
import { IncidencesService } from './incidences.service';
import { ClassSessionContextGuard } from '../class-session-records/class-session-context.guard';
@Module({
  imports: [ClassSessionRecordsModule],
  controllers: [IncidencesController],
  providers: [IncidencesService, ClassSessionContextGuard],
})
export class IncidencesModule {}
