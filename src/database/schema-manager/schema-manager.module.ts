import { Module } from '@nestjs/common';
import { DrizzleModule } from '../drizzle/drizzle.module';
import { SchemaManagerService } from './schema-manger.service';

@Module({
  imports: [DrizzleModule],
  providers: [SchemaManagerService],
  exports: [SchemaManagerService],
})
export class SchemaManagerModule {}
