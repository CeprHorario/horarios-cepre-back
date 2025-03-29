import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { PrismaClientFactory } from './prisma-client.factory';
import { AlsModule } from '@modules/shared/als.module';
import { SchemaManagerModule } from 'schema-manager/schema-manager.module';

@Module({
  imports: [AlsModule, SchemaManagerModule],
  providers: [PrismaService, PrismaClientFactory],
  exports: [PrismaService],
})
export class PrismaModule {}
