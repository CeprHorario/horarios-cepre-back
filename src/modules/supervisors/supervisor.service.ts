import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@database/prisma/prisma.service';
import { SupervisorBaseDto } from './dto';
import { plainToInstance } from 'class-transformer';
import { MonitorForSupervisorDto } from '@modules/monitors/dto/monitorForSupervisor.dto';
import { ClassForSupervisorDto } from '@modules/classes/dto/classForSupervisor.dto';
import { CreateSupervisorWithUserDto } from './dto/create-supervisor.dto';
import { Role } from '@modules/auth/decorators/authorization.decorator';
import { UpdateSupervisorWithProfileDto } from './dto/update-supervisor-with-profile.dto';
import { SupervisorGetSummaryDto } from './dto/supervisor-get-summary.dto';
import { AssignMonitorDto } from './dto/assign-monitor.dto';

@Injectable()
export class SupervisorService {
  constructor(private prisma: PrismaService) {}

  // ─────── CRUD ───────
  async createSupervisor(
    createDto: CreateSupervisorWithUserDto,
  ): Promise<SupervisorBaseDto> {
    return this.prisma.getClient().$transaction(async (tx) => {
      // Crear usuario, perfil y profesor
      const user = await tx.user.create({
        data: {
          email: createDto.email,
          role: Role.SUPERVISOR,
          isActive: true,
          userProfile: {
            create: {
              dni: createDto.dni,
              firstName: createDto.firstName,
              lastName: createDto.lastName,
              phone: createDto.phone,
              phonesAdditional: createDto.phonesAdditional || [],
              personalEmail: createDto.personalEmail,
            },
          },
          supervisor: {
            create: {},
          },
        },
        include: {
          userProfile: true,
        },
      });

      return this.mapToSupervisorDto(user);
    });
  }

  async findAll(
    page: number = 1,
    limit: number = 20,
  ): Promise<{
    data: SupervisorGetSummaryDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    const offset = (page - 1) * limit;

    // Filtro para supervisores con usuarios activos
    const activeFilter = {
      users: {
        isActive: true,
      },
    };

    const [supervisors, total] = await this.prisma.getClient().$transaction([
      this.prisma.getClient().supervisor.findMany({
        skip: offset,
        take: limit,
        where: activeFilter,
        select: {
          id: true,
          shiftId: true,
          users: {
            select: {
              isActive: true,
              userProfile: {
                select: {
                  firstName: true,
                  lastName: true,
                  personalEmail: true,
                  phone: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.getClient().supervisor.count({
        // Conteo de activos
        where: activeFilter,
      }),
    ]);

    const data = supervisors.map((supervisor) =>
      plainToInstance(SupervisorGetSummaryDto, {
        id: supervisor.id,
        shiftId: supervisor.shiftId || null, // Mapear shiftId
        firstName: supervisor.users?.userProfile?.firstName || '',
        lastName: supervisor.users?.userProfile?.lastName || '',
        personalEmail: supervisor.users?.userProfile?.personalEmail || null,
        phone: supervisor.users?.userProfile?.phone || null,
      }),
    );

    return { data, total, page, limit };
  }

  async findOne(id: string): Promise<SupervisorBaseDto> {
    const supervisor = await this.prisma.getClient().supervisor.findUnique({
      where: { id },
      include: { users: true }, // Incluye la relación con el usuario
    });
    if (!supervisor) {
      throw new NotFoundException(`Supervisor with ID ${id} not found`);
    }
    return this.mapToSupervisorDto(supervisor);
  }

  async update(
    id: string,
    updateSupervisorDto: UpdateSupervisorWithProfileDto,
  ): Promise<SupervisorGetSummaryDto> {
    const supervisor = await this.prisma.getClient().supervisor.update({
      where: { id },
      data: {
        users: {
          update: {
            userProfile: {
              update: {
                firstName: updateSupervisorDto.firstName,
                lastName: updateSupervisorDto.lastName,
                personalEmail: updateSupervisorDto.personalEmail,
                phone: updateSupervisorDto.phone,
              },
            },
          },
        },
      },
      include: {
        users: {
          select: {
            userProfile: {
              select: {
                firstName: true,
                lastName: true,
                personalEmail: true,
                phone: true,
              },
            },
          },
        },
      },
    });

    return plainToInstance(SupervisorGetSummaryDto, {
      id: supervisor.id,
      firstName: supervisor.users?.userProfile?.firstName || '',
      lastName: supervisor.users?.userProfile?.lastName || '',
      personalEmail: supervisor.users?.userProfile?.personalEmail || null,
      phone: supervisor.users?.userProfile?.phone || null,
    });
  }

  async delete(id: string): Promise<SupervisorBaseDto> {
    const supervisor = await this.prisma.getClient().supervisor.delete({
      where: { id },
      include: { users: true }, // Incluye la relación con el usuario
    });
    return this.mapToSupervisorDto(supervisor);
  }

  async getMonitors(userId: string): Promise<MonitorForSupervisorDto[]> {
    // Buscar el ID del supervisor
    const monitors = await this.prisma.getClient().monitor.findMany({
      where: {
        supervisors: {
          userId: userId,
        },
      },
      include: {
        user: {
          select: {
            id: true,
            userProfile: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
          },
        },
        classes: {
          select: {
            name: true,
            urlMeet: true,
          },
        },
      },
    });

    if (!monitors) {
      throw new NotFoundException(
        'No se encontraron monitores asignados a este supervisor',
      );
    }

    return monitors.map((monitor) =>
      plainToInstance(MonitorForSupervisorDto, {
        user_id: monitor.user.id,
        profile: monitor.user?.userProfile
          ? {
              firstName: monitor.user.userProfile.firstName,
              lastName: monitor.user.userProfile.lastName,
            }
          : null,
        classes: monitor.classes
          ? plainToInstance(ClassForSupervisorDto, monitor.classes, {
              excludeExtraneousValues: true,
            })
          : null,
      }),
    );
  }

  async updateSupervisorWithProfile(
    id: string,
    data: UpdateSupervisorWithProfileDto,
  ) {
    const supervisor = await this.prisma.getClient().supervisor.update({
      where: { id },
      data: {
        users: {
          update: {
            userProfile: {
              update: data,
            },
          },
        },
      },
      include: { users: true }, // Incluye la relación con el usuario
    });

    if (!supervisor) {
      throw new NotFoundException(`Supervisor with ID ${id} not found`);
    }
    return supervisor;
  }

  async deactivate(id: string) {
    const supervisor = await this.prisma.getClient().supervisor.findUnique({
      where: { id },
      include: {
        users: {
          include: {
            userProfile: { select: { firstName: true, lastName: true } },
          },
        },
      }, // Incluir la relación con usuario
    });
    if (!supervisor) {
      throw new NotFoundException('Teacher not found');
    }
    if (!supervisor.users) {
      throw new NotFoundException('Associated user not found');
    }
    await this.prisma.getClient().user.update({
      where: { id: supervisor.users.id },
      data: { isActive: false },
    });
    return plainToInstance(SupervisorBaseDto, {
      firstName: supervisor.users?.userProfile?.firstName || '',
      lastName: supervisor.users?.userProfile?.lastName || '',
    });
  }

  async assignMonitor(
    assignMonitorDto: AssignMonitorDto,
  ): Promise<{ mensaje: string }> {
    const { id_monitor, id_supervisor } = assignMonitorDto;

    const monitor = await this.prisma.getClient().monitor.findUnique({
      where: { id: id_monitor },
    });

    if (!monitor) {
      throw new NotFoundException({
        mensaje: `El monitor con ID ${id_monitor} no fue encontrado.`,
      });
    }

    if (id_supervisor) {
      // Asignar monitor a supervisor
      const supervisor = await this.prisma.getClient().supervisor.findUnique({
        where: { id: id_supervisor },
      });

      if (!supervisor) {
        throw new NotFoundException({
          mensaje: `El supervisor con ID ${id_supervisor} no fue encontrado.`,
        });
      }

      await this.prisma.getClient().monitor.update({
        where: { id: id_monitor },
        data: { supervisorId: id_supervisor },
      });

      return {
        mensaje: `El monitor con ID ${id_monitor} fue asignado al supervisor con ID ${id_supervisor}.`,
      };
    } else {
      // Desasignar monitor
      await this.prisma.getClient().monitor.update({
        where: { id: id_monitor },
        data: { supervisorId: null },
      });

      return {
        mensaje: `El monitor con ID ${id_monitor} fue desasignado de cualquier supervisor.`,
      };
    }
  }

  // ─────── Métodos auxiliares ───────

  private mapToSupervisorDto(obj: any): SupervisorBaseDto {
    return plainToInstance(SupervisorBaseDto, obj);
  }
}
