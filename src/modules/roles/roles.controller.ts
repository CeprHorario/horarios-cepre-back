import {
  Controller,
  Post,
  Body,
  Get,
  Put,
  Param,
  Delete,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
} from '@nestjs/common';
import { RolesService } from './roles.service';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CreateRoleDto, RoleResponseDto, UpdateRoleDto } from './dto';
import { Authorization } from '@modules/auth/decorators/authorization.decorator';

@Controller('roles')
@ApiTags('Roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get('permissions')
  @HttpCode(HttpStatus.OK)
  @Authorization({
    permission: 'role.listWithPermissions',
    description: 'Obtener todos los roles con sus permisos',
  })
  @ApiOperation({
    summary: 'Obtener todos los roles con sus permisos',
    description: 'Get all roles with their permissions',
  })
  getAllWithPermissions() {
    return this.rolesService.getAllWithPermissions();
  }

  // ─────── CRUD ───────
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Authorization({
    permission: 'role.create',
    description: 'Crear un nuevo rol',
  })
  @ApiOperation({
    summary: 'Crear un nuevo rol',
    description: 'Create a new role',
  })
  create(@Body() createRoleDto: CreateRoleDto): Promise<RoleResponseDto> {
    return this.rolesService.create(createRoleDto);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @Authorization({
    permission: 'role.list',
    description: 'Listar todos los roles',
  })
  @ApiOperation({
    summary: 'Obtener todos los roles',
    description: 'Get all roles',
  })
  getAll() {
    return this.rolesService.getAll();
  }

  @Put(':id')
  @HttpCode(HttpStatus.OK)
  @Authorization({
    permission: 'role.update',
    description: 'Actualizar un rol',
  })
  @ApiOperation({
    summary: 'Actualizar un rol',
    description: 'Update a role',
  })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateRoleDto: UpdateRoleDto,
  ) {
    return this.rolesService.update(id, updateRoleDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Authorization({
    permission: 'role.delete',
    description: 'Eliminar un rol',
  })
  @ApiOperation({
    summary: 'Eliminar un rol',
    description: 'Delete a role',
  })
  deleteRole(@Param('id', ParseIntPipe) id: number) {
    return this.rolesService.delete(id);
  }

  // ─────── Ot
  @Get(':name')
  @HttpCode(HttpStatus.OK)
  @Authorization({
    permission: 'role.getByName',
    description: 'Obtener un rol por nombre',
  })
  @ApiOperation({
    summary: 'Obtener un rol con sus permisos',
    description: 'Get a role with its permissions',
  })
  getRoleWithPermissions(@Param('name') name: string) {
    return this.rolesService.getAllPermissionsByRolName(name);
  }
}
