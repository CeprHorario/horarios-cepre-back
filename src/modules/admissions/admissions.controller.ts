import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { AdmissionsService } from './admissions.service';
import { ApiOperation } from '@nestjs/swagger';
import { Authorization } from '@modules/auth/decorators/authorization.decorator';
import { ProcessAdmissionDto } from './dto/create-admission.dto';
import { Unauthenticated } from '@modules/auth/decorators/unauthenticated.decorator';

@Controller('admissions')
export class AdmissionsController {
  constructor(private readonly service: AdmissionsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Unauthenticated()
  // @Authorization({
  //   permission: 'admission.create',
  //   description: 'Crear un nuevo proceso de admisión',
  // })
  @ApiOperation({
    summary: 'Crear un nuevo proceso de admisión',
    description: 'Create a new process admision',
  })
  async create(@Body() body: ProcessAdmissionDto) {
    return await this.service.create(body);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @Authorization({
    permission: 'admission.getAll',
    description: 'Obtener todos los procesos de admisión',
  })
  @ApiOperation({
    summary: 'Obtener todos los procesos de admisión',
    description: 'Get all admission processes',
  })
  async getAll() {
    return await this.service.getAllRelations();
  }

  @Get('all')
  @HttpCode(HttpStatus.OK)
  @Authorization({
    permission: 'admission.getAllWithCache',
    description: 'Obtener todos los procesos de admisión',
  })
  @ApiOperation({
    summary: 'Obtener todos los procesos de admisión',
    description: 'Get all admission processes',
  })
  async getAllWithCache() {
    return await this.service.getAllWithCache();
  }

  @Get('current')
  @HttpCode(HttpStatus.OK)
  @Authorization({
    permission: 'admission.getCurrent',
    description: 'Obtener el proceso de admisión actual',
  })
  @ApiOperation({
    summary: 'Obtener el proceso de admisión actual',
    description: 'Get the current admission process',
  })
  async getCurrent() {
    return await this.service.getCurrent();
  }

  @Get(':name')
  @HttpCode(HttpStatus.OK)
  @Authorization({
    permission: 'admission.getOneByName',
    description: 'Obtener un proceso de admisión por nombre',
  })
  @ApiOperation({
    summary: 'Obtener un proceso de admisión por nombre',
    description: 'Get an admission process by name',
  })
  async getOneWithObservations(@Param('name') name: string) {
    return await this.service.getOneWithObservations(name);
  }
}
