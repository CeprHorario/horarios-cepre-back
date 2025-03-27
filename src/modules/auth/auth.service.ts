import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '@database/prisma/prisma.service';
import { AuthResponseDto } from '@modules/auth/dto/auth-google.dto';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async validateGoogleUser(profile: any): Promise<AuthResponseDto> {
    const {emails } = profile;
    const email = emails?.[0]?.value;

    const user = await this.prisma
      .getClient()
      .user.findUnique({ where: { email } });
    if (!user) {
      throw new UnauthorizedException(
        'Acceso no autorizado. Contacta al administrador.',
      );
    }
    const payload = { email: user.email, id: user.id, role: user.role };
    const token = this.jwtService.sign(payload);
    return {
      token,
    };
  }
}
