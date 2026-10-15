import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Firestore, Settings } from '@google-cloud/firestore';
import { SchemaManagerModule } from '@database/schema-manager/schema-manager.module';
import { RuntimeConfigController } from './runtime-config.controller';
import {
  FIRESTORE_CLIENT,
  RuntimeConfigService,
} from './runtime-config.service';

@Module({
  imports: [SchemaManagerModule],
  controllers: [RuntimeConfigController],
  providers: [
    {
      provide: FIRESTORE_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const settings: Settings = {
          databaseId: configService.get<string>(
            'FIRESTORE_DATABASE_ID',
            '(default)',
          ),
        };
        const projectId = configService.get<string>('GOOGLE_CLOUD_PROJECT');
        if (projectId) settings.projectId = projectId;
        return new Firestore(settings);
      },
    },
    RuntimeConfigService,
  ],
  exports: [RuntimeConfigService],
})
export class RuntimeConfigModule {}
