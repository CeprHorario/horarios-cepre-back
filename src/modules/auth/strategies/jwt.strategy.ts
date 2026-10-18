import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@database/prisma/prisma.service';
import { RequestContext } from '@database/schema-manager/request-context';
import { SchemaManagerService } from '@database/schema-manager/schema-manger.service';
import { isUUID } from 'class-validator';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
    private readonly schemas: SchemaManagerService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
      algorithms: ['HS256'],
      issuer: 'cepr',
      audience: 'cepr-api',
    });
  }

  async validate(payload: {
    id?: unknown;
    role?: unknown;
    email?: unknown;
    schema?: unknown;
    exp?: unknown;
  }) {
    if (
      typeof payload.id !== 'string' ||
      !(isUUID(payload.id, '4') || isUUID(payload.id, '7')) ||
      typeof payload.exp !== 'number' ||
      !Number.isFinite(payload.exp) ||
      payload.exp <= Date.now() / 1000
    )
      throw new UnauthorizedException();
    const schema =
      payload.role === 'administrador'
        ? 'core_schema'
        : this.context.require().routing?.userSchema;
    if (!schema || payload.schema !== schema)
      throw new UnauthorizedException(
        'La sesión no corresponde al proceso activo',
      );
    await this.schemas.assertAvailable(schema);
    const user = await this.prisma.getClientForSchema(schema).user.findUnique({
      where: { id: payload.id },
      include: { userProfile: true },
    });
    if (
      !user?.isActive ||
      user.role !== payload.role ||
      user.email !== payload.email ||
      (user.role === 'administrador' && schema !== 'core_schema')
    )
      throw new UnauthorizedException();
    return {
      userId: user.id,
      email: user.email,
      role: user.role,
      firstName: user.userProfile?.firstName,
      lastName: user.userProfile?.lastName,
    };
  }
}
