import { Injectable } from '@nestjs/common';
import { PrismaService } from '@database/prisma/prisma.service';
import { AuthResponseDto } from '@modules/auth/dto/auth-google.dto';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@modules/auth/decorators/authorization.decorator';
import { RequestContext } from '@database/schema-manager/request-context';
import { SchemaManagerService } from '@database/schema-manager/schema-manger.service';
import type { Profile } from 'passport-google-oauth20';
import {
  COORDINATOR_ROLE,
  parseCoordinatorRole,
} from '@modules/auth/utils/coordinator-role';
export interface AuthenticatedUser {
  userId: string;
  email: string;
  role: string;
  firstName?: string;
  lastName?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private context: RequestContext,
    private schemas: SchemaManagerService,
  ) {}

  async validateGoogleUser(profile: Profile): Promise<AuthResponseDto> {
    const { emails } = profile;
    const email = emails?.[0]?.value;

    if (!email || !emails?.[0]?.verified) return {};

    const coreSchema = 'core_schema';
    await this.schemas.assertAvailable(coreSchema);
    const coreUser = await this.prisma
      .getClientForSchema(coreSchema)
      .user.findUnique({ where: { email } });

    let user = coreUser?.role === Role.ADMIN ? coreUser : null;
    let schema = coreSchema;
    if (!user) {
      const userSchema = this.context.require().routing!.userSchema;
      schema = userSchema;
      await this.schemas.assertAvailable(userSchema);
      user = await this.prisma
        .getClientForSchema(userSchema)
        .user.findUnique({ where: { email } });
    }

    if (
      !user?.isActive ||
      (user.role === String(Role.ADMIN) && user !== coreUser)
    ) {
      return {};
    }

    const payload = { email: user.email, id: user.id, role: user.role, schema };
    const token = this.jwtService.sign(payload);
    return {
      token,
    };
  }

  getUserInfo(user: AuthenticatedUser) {
    const coordinatorScope = parseCoordinatorRole(user.role);

    return {
      id: user.userId,
      email: user.email,
      role: coordinatorScope.isCoordinator ? COORDINATOR_ROLE : user.role,
      rawRole: user.role,
      coordinatorCourseId: coordinatorScope.courseId ?? null,
      firstName: user.firstName,
      lastName: user.lastName,
    };
  }
}
