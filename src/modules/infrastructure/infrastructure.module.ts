import { Module } from '@nestjs/common';
import { InfrastructureController } from './infrastructure.controller';
import { InfrastructureService } from './infrastructure.service';

@Module({
  controllers: [InfrastructureController],
  providers: [InfrastructureService],
  exports: [InfrastructureService], //para otros modulos
})
export class InfrastructureModule {}
