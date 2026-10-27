import { Module } from '@nestjs/common';
import { DrizzleModule } from '@database/drizzle/drizzle.module';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';

@Module({
  imports: [DrizzleModule],
  controllers: [ImportsController],
  providers: [ImportsService],
})
export class ImportsModule {}
