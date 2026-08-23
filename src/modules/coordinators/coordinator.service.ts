import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@database/prisma/prisma.service';
import { plainToInstance } from 'class-transformer';
import {
  COORDINATOR_ROLE,
  parseCoordinatorRole,
} from '@modules/auth/utils/coordinator-role';
import {
  CoordinatorResponseDto,
  CreateCoordinatorDto,
  UpdateCoordinatorDto,
} from './dto';

@Injectable()
export class CoordinatorService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateCoordinatorDto): Promise<CoordinatorResponseDto> {
    if (data.courseId !== undefined) {
      await this.ensureCourseExists(data.courseId);
    }

    const user = await this.prisma.getClient().user.create({
      data: {
        email: data.email,
        role: this.buildCoordinatorRole(data.courseId),
        isActive: true,
        userProfile: {
          create: {
            dni: data.dni,
            firstName: data.firstName,
            lastName: data.lastName,
            phone: data.phone,
            phonesAdditional: data.phonesAdditional || [],
            personalEmail: data.personalEmail,
          },
        },
      },
      include: {
        userProfile: true,
      },
    });

    return this.mapToDto(user);
  }

  async findAll(
    page: number = 1,
    limit: number = 20,
  ): Promise<{
    data: CoordinatorResponseDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    const skip = (page - 1) * limit;
    const where = {
      isActive: true,
      OR: [
        { role: COORDINATOR_ROLE },
        { role: { startsWith: `${COORDINATOR_ROLE}-` } },
      ],
    };

    const [users, total] = await this.prisma.getClient().$transaction([
      this.prisma.getClient().user.findMany({
        skip,
        take: limit,
        where,
        include: { userProfile: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.getClient().user.count({ where }),
    ]);

    return {
      data: await Promise.all(users.map((user) => this.mapToDto(user))),
      total,
      page,
      limit,
    };
  }

  async findOne(id: string): Promise<CoordinatorResponseDto> {
    const user = await this.findCoordinatorUser(id);
    return this.mapToDto(user);
  }

  async update(
    id: string,
    data: UpdateCoordinatorDto,
  ): Promise<CoordinatorResponseDto> {
    await this.findCoordinatorUser(id);
    await this.ensureUniqueFields(id, data);

    if (data.courseId !== undefined && data.courseId !== null) {
      await this.ensureCourseExists(data.courseId);
    }

    const user = await this.prisma.getClient().user.update({
      where: { id },
      data: {
        email: data.email,
        role:
          data.courseId !== undefined
            ? this.buildCoordinatorRole(data.courseId)
            : undefined,
        userProfile: {
          update: {
            dni: data.dni,
            firstName: data.firstName,
            lastName: data.lastName,
            phone: data.phone,
            phonesAdditional: data.phonesAdditional,
            personalEmail: data.personalEmail,
          },
        },
      },
      include: { userProfile: true },
    });

    return this.mapToDto(user);
  }

  async deactivate(id: string): Promise<CoordinatorResponseDto> {
    await this.findCoordinatorUser(id);

    const user = await this.prisma.getClient().user.update({
      where: { id },
      data: { isActive: false },
      include: { userProfile: true },
    });

    return this.mapToDto(user);
  }

  private async findCoordinatorUser(id: string) {
    const user = await this.prisma.getClient().user.findFirst({
      where: {
        id,
        OR: [
          { role: COORDINATOR_ROLE },
          { role: { startsWith: `${COORDINATOR_ROLE}-` } },
        ],
      },
      include: { userProfile: true },
    });

    if (!user) {
      throw new NotFoundException('Coordinador no encontrado');
    }

    return user;
  }

  private async ensureCourseExists(courseId: number): Promise<void> {
    const course = await this.prisma.getClient().course.findUnique({
      where: { id: courseId },
    });

    if (!course) {
      throw new NotFoundException('Curso no encontrado');
    }
  }

  private async ensureUniqueFields(
    id: string,
    data: UpdateCoordinatorDto,
  ): Promise<void> {
    if (data.email) {
      const existingEmail = await this.prisma.getClient().user.findFirst({
        where: { email: data.email, NOT: { id } },
      });

      if (existingEmail) {
        throw new ConflictException('El correo institucional ya esta en uso');
      }
    }

    if (data.dni || data.personalEmail) {
      const existingProfile = await this.prisma
        .getClient()
        .userProfile.findFirst({
          where: {
            userId: { not: id },
            OR: [
              ...(data.dni ? [{ dni: data.dni }] : []),
              ...(data.personalEmail
                ? [{ personalEmail: data.personalEmail }]
                : []),
            ],
          },
        });

      if (existingProfile) {
        throw new ConflictException('DNI o correo personal ya esta en uso');
      }
    }
  }

  private buildCoordinatorRole(courseId?: number | null): string {
    return courseId ? `${COORDINATOR_ROLE}-${courseId}` : COORDINATOR_ROLE;
  }

  private async mapToDto(user: {
    id: string;
    email: string;
    role: string;
    isActive: boolean;
    userProfile: {
      dni: string | null;
      firstName: string;
      lastName: string;
      phone: string | null;
      phonesAdditional: string[];
      personalEmail: string | null;
    } | null;
  }): Promise<CoordinatorResponseDto> {
    const courseId = parseCoordinatorRole(user.role).courseId ?? null;
    const course =
      courseId === null
        ? null
        : await this.prisma.getClient().course.findUnique({
            where: { id: courseId },
            select: { name: true },
          });

    return plainToInstance(CoordinatorResponseDto, {
      id: user.id,
      email: user.email,
      role: user.role,
      courseId,
      courseName: course?.name ?? null,
      dni: user.userProfile?.dni ?? null,
      firstName: user.userProfile?.firstName ?? '',
      lastName: user.userProfile?.lastName ?? '',
      phone: user.userProfile?.phone ?? null,
      phonesAdditional: user.userProfile?.phonesAdditional ?? [],
      personalEmail: user.userProfile?.personalEmail ?? null,
      isActive: user.isActive,
    });
  }
}
