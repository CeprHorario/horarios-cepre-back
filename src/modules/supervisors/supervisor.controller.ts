import {
  Body,
  Controller,
  Post,
  Get,
  Param,
  Put,
  Delete,
  UseGuards,
  Req,
  BadRequestException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { SupervisorService } from './supervisor.service';
import { CreateSupervisorDto, UpdateSupervisorDto, UpdateSupervisorWithProfileDto } from './dto';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Authorization, Role } from '@modules/auth/decorators/authorization.decorator';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';

@Controller('supervisors')
@UseGuards(JwtAuthGuard)
export class SupervisorController {
  constructor(private readonly supervisorService: SupervisorService) {}

  @Post()
  @Authorization({
    permission: 'supervisor.create',
    description: 'Crear un nuevo supervisor',
  })
  create(@Body() createSupervisorDto: CreateSupervisorDto) {
    return this.supervisorService.create(createSupervisorDto);
  }

  @Get()
  @Authorization({
    permission: 'supervisor.list',
    description: 'Obtener todos los supervisores',
  })
  findAll() {
    return this.supervisorService.findAll();
  }

  @Get('getMonitors')
  @Authorization({
    roles: [Role.SUPERVISOR],
    permission: 'supervisor.getMonitors',
    description: 'Obtiene los monitores de este supervisor',
  })
  @ApiOperation({ summary: 'Obtener los monitores de este supervisor' })
  @ApiResponse({ status: 200, description: 'Monitores obtenidos.' })
  @ApiResponse({ status: 404, description: 'Ta sin monitores.' })
  getMonitors(@Req() req) {
    console.log('Usuario autenticado:', req.user); // Debugging
    const userId = req.user?.userId; // Verifica que exista

    if (!userId) {
      throw new BadRequestException('No se encontró el userId en la solicitud');
    }
    return this.supervisorService.getMonitors(userId);
  }

  @Get(':id')
  @Authorization({
    permission: 'supervisor.get',
    description: 'Obtener un supervisor por su ID',
  })
  findOne(@Param('id') id: string) {
    return this.supervisorService.findOne(id);
  }

  @Post(':id/updateProfile')
  @HttpCode(HttpStatus.OK)
  @Authorization({
    permission: 'supervisor.updateProfile',
    description: 'Actualizar el perfil de un supervisor',
  })
  updateProfile(
    @Param('id') id: string,
    @Body() data: UpdateSupervisorWithProfileDto,
  ) {
    return this.supervisorService.updateSupervisorWithProfile(id, data);
  }

  @Put(':id')
  @Authorization({
    permission: 'supervisor.update',
    description: 'Actualizar un supervisor',
  })
  update(
    @Param('id') id: string,
    @Body() updateSupervisorDto: UpdateSupervisorDto,
  ) {
    return this.supervisorService.update(id, updateSupervisorDto);
  }

  @Delete(':id')
  @Authorization({
    permission: 'supervisor.delete',
    description: 'Eliminar un supervisor',
  })
  delete(@Param('id') id: string) {
    return this.supervisorService.delete(id);
  }
}
