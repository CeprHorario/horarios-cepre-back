import { Module } from '@nestjs/common';

import { AppController } from './app.controller';
import { AppService } from './app.service';

// Modules
import appConfig from 'src/config/app.config';
import { DatabaseModule } from '@database/database.module';
import { ConfigModule } from '@nestjs/config';
import { ModulesModule } from '@modules/modules.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [appConfig],
      isGlobal: true,
    }),
    DatabaseModule,
    ModulesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
