import { Module } from '@nestjs/common';
import { DrizzleModule } from './drizzle/drizzle.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [DrizzleModule, PrismaModule],
  exports: [DrizzleModule, PrismaModule],
})
export class DatabaseModule {}
