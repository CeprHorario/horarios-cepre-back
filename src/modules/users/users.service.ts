import { Injectable } from '@nestjs/common';
import { PrismaService } from '@database/prisma/prisma.service';
import { UserBaseDto } from './dto';
import { CreateUserDto } from './dto/index';
import { plainToInstance } from 'class-transformer';
import { Prisma } from '@prisma/client';
import { Role } from '@modules/auth/decorators/authorization.decorator';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async users(params: {
    skip?: number;
    take?: number;
  }): Promise<UserBaseDto[]> {
    const { skip, take } = params;
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
    const userData: Prisma.UserCreateInput[] = createUserDto.map((user) => {
      const userInput: Prisma.UserCreateInput = {
        email: user.email,
        role: user.role,
      };

      switch (user.role) {
        case Role.MONITOR:
          userInput.monitor = { create: {} };
          break;
        case Role.SUPERVISOR:
          userInput.supervisor = { create: {} };
          break;
      }

      return userInput;
    });

    // Crear usuarios de forma individual para respetar las relaciones
    const createdUsers = await Promise.all(
      userData.map((user) =>
        this.prisma.getClient().user.create({
          data: user,
        }),
      ),
    );

    return plainToInstance(UserBaseDto, createdUsers, {
      excludePrefixes: ['password', 'googleId', 'updatedAt', 'lastLogin'],
    });
  }
}
