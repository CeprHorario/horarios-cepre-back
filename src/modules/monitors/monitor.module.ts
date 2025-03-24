import { Module } from '@nestjs/common';
import { MonitorController } from './monitor.controller';
import { MonitorService } from './monitor.service';

@Module({
  controllers: [MonitorController],
  providers: [MonitorService],
  exports: [MonitorService], //para otros modulos
})
export class MonitorModule {}
