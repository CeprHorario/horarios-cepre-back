import { Module } from '@nestjs/common';
import { MonitorController } from './monitor.controller';
import { MonitorService } from './monitor.service';
import { PrismaModule } from '@database/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [MonitorController],
  providers: [MonitorService],
  exports: [MonitorService], //para otros modulos
})
export class MonitorModule {}
