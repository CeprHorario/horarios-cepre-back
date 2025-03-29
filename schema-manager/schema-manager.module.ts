import { Global, Module } from '@nestjs/common';
import { AlsModule } from '@modules/shared/als.module';
import { SchemaManagerService } from './schema-manger.service';
import { DrizzleModule } from '@database/drizzle/drizzle.module';
import { CacheModule } from '@nestjs/cache-manager';

@Global()
@Module({
  imports: [AlsModule, DrizzleModule, CacheModule.register()],
  providers: [SchemaManagerService],
  exports: [SchemaManagerService],
})
export class SchemaManagerModule {}
