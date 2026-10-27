import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@database/prisma/prisma.service';
import { UserBaseDto } from './dto';
import { CreateUserDto } from './dto/index';
import { plainToInstance } from 'class-transformer';
import { Prisma } from '../../generated/prisma/client';
import { Role } from '@modules/auth/decorators/authorization.decorator';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async users(params: {
    skip?: number;
    take?: number;
  }): Promise<UserBaseDto[]> {
    const { skip, take } = params;
    if (
      !Number.isSafeInteger(skip ?? 0) ||
      (skip ?? 0) < 0 ||
      !Number.isSafeInteger(take ?? 10) ||
      (take ?? 10) < 1 ||
      (take ?? 10) > 500
    )
      throw new BadRequestException('Paginación inválida; máximo 500 usuarios');
    const users = await this.prisma.getClient().user.findMany({
      skip,
      take,
    });
    return users.map((user) =>
      plainToInstance(
        UserBaseDto,
        {
          ...user,
          lastLogin: user.lastLogin ?? undefined,
        },
        {
          excludePrefixes: ['password', 'googleId', 'updatedAt', 'lastLogin'],
        },
      ),
    );
  }

  async createUser(obj: CreateUserDto): Promise<UserBaseDto> {
    const user: Prisma.UserCreateInput = {
      email: obj.email,
      role: obj.role,
    };

    switch (obj.role) {
      case Role.MONITOR:
        user.monitor = { create: {} };
        break;
      case Role.SUPERVISOR:
        user.supervisor = { create: {} };
        break;
    }

    const createdUser = await this.prisma.getClient().user.create({
      data: user,
    });
    return plainToInstance(UserBaseDto, createdUser, {
      excludePrefixes: ['password', 'googleId'],
    });
  }

  async createManyUsers(
    createUserDto: CreateUserDto[],
  ): Promise<UserBaseDto[]> {
    if (
      !Array.isArray(createUserDto) ||
      !createUserDto.length ||
      createUserDto.length > 1000
    )
      throw new BadRequestException('Se requieren entre 1 y 1000 usuarios');
    const createdUsers = await this.prisma
      .getClient()
      .$transaction(async (tx) => {
        const users = await tx.user.createManyAndReturn({
          data: createUserDto.map(({ email, role }) => ({ email, role })),
        });
        const monitors = users
          .filter((user) => user.role === String(Role.MONITOR))
          .map((user) => ({ userId: user.id }));
        const supervisors = users
          .filter((user) => user.role === String(Role.SUPERVISOR))
          .map((user) => ({ userId: user.id }));
        if (monitors.length) await tx.monitor.createMany({ data: monitors });
        if (supervisors.length)
          await tx.supervisor.createMany({ data: supervisors });
        return users;
      });

    return plainToInstance(UserBaseDto, createdUsers, {
      excludePrefixes: ['password', 'googleId', 'updatedAt', 'lastLogin'],
    });
  }
}
