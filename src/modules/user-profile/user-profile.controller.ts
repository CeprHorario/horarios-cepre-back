import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UserProfileService } from './user-profile.service';
import type { AuthenticatedRequest } from '@modules/auth/authenticated-request';
import { CreateUserProfileDto } from './dto/create-user-profile.dto';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';
import {
  Authorization,
  Role,
} from '@modules/auth/decorators/authorization.decorator';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';

@Controller('user-profiles')
@UseGuards(JwtAuthGuard)
export class UserProfileController {
  constructor(private readonly userProfileService: UserProfileService) {}

  @Authorization({
    permission: 'userProfile.create',
    roles: [Role.ADMIN],
  })
  @Post()
  create(@Req() req: AuthenticatedRequest, @Body() createUserProfileDto: CreateUserProfileDto) {
    const userId = req.user?.userId; // Verifica que exista

    if (!userId) {
      throw new BadRequestException('No se encontró el userId en la solicitud');
    }

    return this.userProfileService.create(userId, createUserProfileDto);
  }

  @Get()
  @Authorization({
    permission: 'userProfile.list',
    roles: [Role.ADMIN],
  })
  findAll() {
    return this.userProfileService.findAll();
  }

  @Get(':id')
  @Authorization({
    permission: 'userProfile.getById',
    description: 'Obtener un perfil de usuario por su id',
  })
  findOne(@Param('id') id: string) {
    return this.userProfileService.findOne(id);
  }

  @Patch(':id')
  @Authorization({
    permission: 'userProfile.update',
    description: 'Actualizar un perfil de usuario por su id',
  })
  update(
    @Param('id') id: string,
    @Body() updateUserProfileDto: UpdateUserProfileDto,
  ) {
    return this.userProfileService.update(id, updateUserProfileDto);
  }

  @Delete(':id')
  @Authorization({
    permission: 'userProfile.delete',
    description: 'Eliminar un perfil de usuario por su id',
  })
  remove(@Param('id') id: string) {
    return this.userProfileService.remove(id);
  }

  @Patch(':id/deactivate')
  @Authorization({
    permission: 'userProfile.deactivate',
    description: 'Desactivar un perfil de usuario por su id',
  })
  async deactivateUserProfile(@Param('id') id: string) {
    return this.userProfileService.deactivate(id);
  }
}
