import { Module } from '@nestjs/common';
import { SupervisorController } from './supervisor.controller';
import { SupervisorService } from './supervisor.service';

@Module({
  controllers: [SupervisorController],
  providers: [SupervisorService],
  exports: [SupervisorService], //para otros modulos
})
export class SupervisorModule {}
