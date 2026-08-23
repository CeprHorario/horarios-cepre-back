import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Authorization } from '@modules/auth/decorators/authorization.decorator';
import { CoordinatorService } from './coordinator.service';
import {
  CoordinatorResponseDto,
  CreateCoordinatorDto,
  UpdateCoordinatorDto,
} from './dto';

@ApiTags('Coordinators')
@Controller('coordinators')
export class CoordinatorController {
  constructor(private readonly coordinatorService: CoordinatorService) {}

  @Post()
  @Authorization({
    permission: 'coordinator.create',
    description: 'Crear un nuevo coordinador',
  })
  @ApiOperation({ summary: 'Crear un nuevo coordinador' })
  @ApiResponse({ status: 201, type: CoordinatorResponseDto })
  create(@Body() data: CreateCoordinatorDto) {
    return this.coordinatorService.create(data);
  }

  @Get()
  @Authorization({
    permission: 'coordinator.list',
    description: 'Obtener coordinadores activos',
  })
  @ApiOperation({ summary: 'Obtener coordinadores activos' })
  findAll(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
  ) {
    return this.coordinatorService.findAll(Number(page), Number(limit));
  }

  @Get(':id')
  @Authorization({
    permission: 'coordinator.get',
    description: 'Obtener un coordinador por su id de usuario',
  })
  @ApiOperation({ summary: 'Obtener un coordinador por su ID de usuario' })
  findOne(@Param('id') id: string) {
    return this.coordinatorService.findOne(id);
  }

  @Put(':id')
  @Authorization({
    permission: 'coordinator.update',
    description: 'Actualizar un coordinador',
  })
  @ApiOperation({ summary: 'Actualizar un coordinador' })
  update(@Param('id') id: string, @Body() data: UpdateCoordinatorDto) {
    return this.coordinatorService.update(id, data);
  }

  @Patch(':id/deactivate')
  @Authorization({
    permission: 'coordinator.deactivate',
    description: 'Desactivar un coordinador',
  })
  @ApiOperation({ summary: 'Desactivar un coordinador' })
  deactivate(@Param('id') id: string) {
    return this.coordinatorService.deactivate(id);
  }
}
