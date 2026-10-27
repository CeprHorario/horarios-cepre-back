import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { GoogleStrategy } from './strategies/google.strategy';
import { ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from '@modules/auth/strategies/jwt.strategy';
import { PrismaModule } from '@database/prisma/prisma.module';
import { SyncAuthorizationService } from './sync-authorization.service';
import { DiscoveryModule } from '@nestjs/core';
import { DrizzleModule } from '@database/drizzle/drizzle.module';
import { RuntimeConfigModule } from '@modules/runtime-config/runtime-config.module';
import { SchemaManagerModule } from '@database/schema-manager/schema-manager.module';
import { PermissionsModule } from '@modules/permissions/permissions.module';
import { RolesModule } from '@modules/roles/roles.module';
import { AuthorizationGuard } from './guards/authorization.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthGlobalGuard } from './guards/auth-global.guard';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { SchemaManagerInterceptor } from '@database/schema-manager/schema-manager.interceptor';
import { GoogleCallbackGuard } from './guards/google-auth.guard';
import { OAuthStateStore } from './oauth-state.store';
import { TokenRevocationService } from './token-revocation.service';

@Module({
  imports: [
    PrismaModule,
    DrizzleModule,
    RuntimeConfigModule,
    SchemaManagerModule,
    PermissionsModule,
    RolesModule,
    DiscoveryModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService], // ✅ Mantiene la inyección de ConfigService
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          algorithm: 'HS256',
          expiresIn: configService.getOrThrow<number>('JWT_EXPIRES_IN'),
          issuer: 'cepr',
          audience: 'cepr-api',
        },
        verifyOptions: {
          algorithms: ['HS256'],
          issuer: 'cepr',
          audience: 'cepr-api',
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenRevocationService,
    JwtStrategy,
    GoogleStrategy,
    GoogleCallbackGuard,
    OAuthStateStore,
    SyncAuthorizationService,
    AuthorizationGuard,
    JwtAuthGuard,
    { provide: APP_GUARD, useClass: AuthGlobalGuard },
    { provide: APP_INTERCEPTOR, useClass: SchemaManagerInterceptor },
  ],
  exports: [AuthService, JwtStrategy],
})
export class AuthModule {}
