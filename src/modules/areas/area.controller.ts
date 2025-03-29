import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  UseInterceptors,
} from '@nestjs/common';
import { AreaService } from './area.service';
import { CreateAreaDto, UpdateAreaDto, AreaBaseDto } from './dto';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaExceptionInterceptor } from '@database/prisma/prisma-exception.interceptor';
import {
  Authorization,
  Role,
} from '@modules/auth/decorators/authorization.decorator';
import { Unauthenticated } from '@modules/auth/decorators/unauthenticated.decorator';
import { SchemaInterceptor } from 'prisma/interceptors/schema.interceptor';
//import { ApiCreatedResponse } from '@nestjs/swagger';
//import { ApiResponse } from '@nestjs/swagger';

@Unauthenticated()
@Controller('areas')
@ApiTags('Areas')
@UseInterceptors(PrismaExceptionInterceptor)
@UseInterceptors(SchemaInterceptor)
export class AreaController {
  constructor(private readonly areaService: AreaService) {}

  // ─────── CRUD ───────
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Authorization({
    roles: [Role.TEACHER, Role.SUPERVISOR, Role.MONITOR],
    permission: 'area.create',
    description: 'Crear un nuevo area',
  })
  @ApiOperation({
    summary: 'Crear un nuevo area',
    description: 'Create a new area',
  })
  create(@Body() createAreaDto: CreateAreaDto): Promise<AreaBaseDto> {
    return this.areaService.create(createAreaDto);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @Authorization({
    roles: [Role.TEACHER, Role.SUPERVISOR],
    permission: 'area.list',
  })
  @ApiOperation({
    summary: 'Obtener todas las areas',
    description: 'Get all areas',
  })
  findAll(): Promise<AreaBaseDto[]> {
    return this.areaService.findAll();
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @Authorization({
    roles: [Role.SUPERVISOR],
    permission: 'area.getById',
  })
  @ApiOperation({
    summary: 'Obtener un area por id',
    description: 'Get an area by id',
  })
  findOne(@Param('id', ParseIntPipe) id: number): Promise<AreaBaseDto> {
    return this.areaService.findOne(id);
  }

  @Put(':id')
  @HttpCode(HttpStatus.OK)
  @Authorization({
    roles: [Role.TEACHER, Role.SUPERVISOR],
    permission: 'area.updateById',
  })
  @ApiOperation({
    summary: 'Actualizar un area por id',
    description: 'Update an area by id',
  })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateAreaDto: UpdateAreaDto,
  ): Promise<AreaBaseDto> {
    return await this.areaService.update(id, updateAreaDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Authorization({
    roles: [Role.MONITOR, Role.SUPERVISOR],
    permission: 'area.deleteById',
  })
  @ApiOperation({
    summary: 'Eliminar un area por id',
    description: 'Delete an area by id',
  })
  delete(@Param('id', ParseIntPipe) id: number): Promise<AreaBaseDto> {
    return this.areaService.delete(id);
  }
}
