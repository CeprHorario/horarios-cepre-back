import { Module } from '@nestjs/common';
import { AreaController } from './area.controller';
import { AreaService } from './area.service';
import { PrismaModule } from 'prisma/prisma.module';
import { AdmissionsModule } from '@modules/admissions/admissions.module';
import { AlsModule } from '@modules/shared/als.module';
@Module({
  imports: [PrismaModule, AdmissionsModule, AlsModule],
  controllers: [AreaController],
  providers: [AreaService],
  exports: [AreaService], //para otros modulos
})
export class AreaModule {}
