import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '@database/prisma/prisma.service';
import { AuthResponseDto } from '@modules/auth/dto/auth-google.dto';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Role } from '@modules/auth/decorators/authorization.decorator';
import { RuntimeConfigService } from '@modules/runtime-config/runtime-config.service';
import {
  COORDINATOR_ROLE,
  parseCoordinatorRole,
} from '@modules/auth/utils/coordinator-role';
//import e from 'express';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private runtimeConfig: RuntimeConfigService,
  ) {}

  async validateGoogleUser(profile: any): Promise<AuthResponseDto> {
    const { emails } = profile;
    const email = emails?.[0]?.value;

    if (!email) return {};

    const coreSchema = this.configService.get<string>(
      'CORE_SCHEMA',
      'core_schema',
    );
    const coreUser = await this.prisma
      .getClientForSchema(coreSchema)
      .user.findUnique({ where: { email } });

    let user = coreUser?.role === Role.ADMIN ? coreUser : null;
    if (!user) {
      const runtime = await this.runtimeConfig.getCurrent();
      const userSchema = runtime?.schemaRouting.userSchema ?? 'default';
      user = await this.prisma
        .getClientForSchema(userSchema)
        .user.findUnique({ where: { email } });
    }

    if (!user) {
      return {};
    }

    const payload = { email: user.email, id: user.id, role: user.role };
    const token = this.jwtService.sign(payload, {
      expiresIn: process.env.JWT_EXPIRES_IN || '8h',
    });
    return {
      token,
    };
  }

  async getUserInfoFromToken(token: string) {
    try {
      const decodedToken = this.jwtService.verify(token);
      const userId = decodedToken.id;
      const user = await this.prisma.getClient().user.findUnique({
        where: { id: userId },
        include: {
          userProfile: true,
        },
      });

      if (!user) {
        throw new UnauthorizedException('Usuario no encontrado');
      }
      const coordinatorScope = parseCoordinatorRole(user.role);

      return {
        id: user.id,
        email: user.email,
        role: coordinatorScope.isCoordinator ? COORDINATOR_ROLE : user.role,
        rawRole: user.role,
        coordinatorCourseId: coordinatorScope.courseId ?? null,
        firstName: user.userProfile?.firstName,
        lastName: user.userProfile?.lastName,
      };
    } catch (error) {
      throw new UnauthorizedException('Token inválido o expirado');
    }
  }
}
