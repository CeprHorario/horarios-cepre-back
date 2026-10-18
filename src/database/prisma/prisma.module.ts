import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { RequestContextModule } from '../schema-manager/request-context';

@Module({
  imports: [RequestContextModule],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
