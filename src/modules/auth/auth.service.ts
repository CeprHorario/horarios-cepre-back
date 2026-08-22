import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '@database/prisma/prisma.service';
import { AuthResponseDto } from '@modules/auth/dto/auth-google.dto';
import { JwtService } from '@nestjs/jwt';
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
  ) {}

  async validateGoogleUser(profile: any): Promise<AuthResponseDto> {
    const { emails } = profile;
    const email = emails?.[0]?.value;

    const user = await this.prisma
      .getClient()
      .user.findUnique({ where: { email } });

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
