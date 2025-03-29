import { Module } from '@nestjs/common';
import { AdmissionsController } from './admissions.controller';
import { AdmissionsService } from './admissions.service';
import { DrizzleModule } from '@database/drizzle/drizzle.module';
import { PrismaModule } from 'prisma/prisma.module';

@Module({
  imports: [DrizzleModule, PrismaModule],
  controllers: [AdmissionsController],
  providers: [AdmissionsService],
  exports: [AdmissionsService],
})
export class AdmissionsModule {}
