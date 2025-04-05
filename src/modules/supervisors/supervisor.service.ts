import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@database/prisma/prisma.service';
import {
  UpdateSupervisorDto,
  SupervisorBaseDto,
} from './dto';
import { plainToInstance } from 'class-transformer';
import { MonitorForSupervisorDto } from '@modules/monitors/dto/monitorForSupervisor.dto';
import { ClassForSupervisorDto } from '@modules/classes/dto/classForSupervisor.dto';
import { CreateSupervisorWithUserDto } from './dto/create-supervisor.dto';
import { Role } from '@modules/auth/decorators/authorization.decorator';
import { UpdateSupervisorWithProfileDto } from './dto/update-supervisor-with-profile.dto';

@Injectable()
export class SupervisorService {
  constructor(private prisma: PrismaService) {}

  // ─────── CRUD ───────
  async createSupervisor(createDto: CreateSupervisorWithUserDto): Promise<SupervisorBaseDto> {
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

  async findAll(): Promise<SupervisorBaseDto[]> {
    const supervisors = await this.prisma.getClient().supervisor.findMany({
      include: { users: true }, // Incluye la relación con el usuario
    });
    return supervisors.map((supervisor) => this.mapToSupervisorDto(supervisor));
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
    updateSupervisorDto: UpdateSupervisorDto,
  ): Promise<SupervisorBaseDto> {
    const supervisor = await this.prisma.getClient().supervisor.update({
      where: { id },
      data: {
        ...updateSupervisorDto,
        updatedAt: new Date().toISOString() // Actualizar fecha de modificación
      },
      include: { users: true },
    });
    return this.mapToSupervisorDto(supervisor);
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
    const supervisor = await this.prisma.getClient().supervisor.findUnique({
      where: { userId: userId }, // Asegura que `user_id` es el campo correcto en `supervisor`
      select: { id: true },
    });

    if (!supervisor) {
      throw new NotFoundException('Supervisor no encontrado');
    }

    // Buscar los monitores asignados a este supervisor
    const monitors = await this.prisma.getClient().monitor.findMany({
      where: { supervisorId: supervisor.id }, // Asocia los monitores al supervisor
      include: {
        user: { select: { id: true }, include: { userProfile: true } }, // Incluye el perfil del usuario
        classes: true, // Incluye las clases asociadas al monitor
      },
    });
    console.log('Monitores obtenidos:', JSON.stringify(monitors, null, 2)); // Debugging

    if (!monitors.length) {
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

  // ─────── Métodos auxiliares ───────

  private mapToSupervisorDto(obj: any): SupervisorBaseDto {
    return plainToInstance(SupervisorBaseDto, obj);
  }
}
