import { Module } from '@nestjs/common';
import { ClassController } from './class.controller';
import { ClassService } from './class.service';
import { PrismaModule } from '@database/prisma/prisma.module';
import { ScheduleModule } from '@modules/schedules/schedules.module';

@Module({
  imports: [PrismaModule, ScheduleModule],
  controllers: [ClassController],
  providers: [ClassService],
  exports: [ClassService], //para otros modulos
})
export class ClassModule {}
