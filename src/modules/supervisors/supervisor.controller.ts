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
} from '@nestjs/common';
import { SupervisorService } from './supervisor.service';
import { UpdateSupervisorDto } from './dto';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Authorization } from '@modules/auth/decorators/authorization.decorator';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { CreateSupervisorWithUserDto } from './dto/create-supervisor.dto';

@Controller('supervisors')
@UseGuards(JwtAuthGuard)
export class SupervisorController {
  constructor(private readonly supervisorService: SupervisorService) {}

  @Post()
  @Authorization({
    permission: 'supervisor.create',
    description: 'Crear un nuevo supervisor',
  })
  async create(@Body() createSupervisorrDto: CreateSupervisorWithUserDto) {
      return this.supervisorService.createSupervisor(createSupervisorrDto);
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
