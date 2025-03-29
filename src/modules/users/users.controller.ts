import {
  Controller,
  Get,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
  Post,
  Body,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { Authorization } from '@modules/auth/decorators/authorization.decorator';
import { CreateUserDto, UserBaseDto } from './dto';
import { ApiBody, ApiOperation } from '@nestjs/swagger';

@Controller('users')
export class UsersController {
  constructor(private readonly userService: UsersService) {}

  // GET /users?skip=0&take=10
  @Get()
  @HttpCode(HttpStatus.OK)
  @Authorization({
    permission: 'users.list',
    description: 'Obtener todos los usuarios',
  })
  @ApiOperation({
    summary: 'Obtener todos los usuarios',
    description: 'Get all users',
  })
  async getUsers(
    @Query('page', new DefaultValuePipe(0), ParseIntPipe) skip: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) take: number,
  ) {
    return this.userService.users({
      skip,
      take,
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Authorization({
    permission: 'users.create',
    description: 'Crear un nuevo usuario',
  })
  @ApiOperation({
    summary: 'Crear un nuevo usuario',
    description: 'Create a new user',
  })
  async createUser(@Body() data: CreateUserDto): Promise<UserBaseDto> {
    return await this.userService.createUser(data);
  }

  @Post('create-many')
  @HttpCode(HttpStatus.CREATED)
  @Authorization({
    permission: 'users.createMany',
    description: 'Crear muchos usuarios',
  })
  @ApiOperation({
    summary: 'Crear muchos usuarios',
    description: 'Create many users',
  })
  @ApiBody({ type: [CreateUserDto] })
  async createManyUsers(@Body() data: CreateUserDto[]): Promise<UserBaseDto[]> {
    return await this.userService.createManyUsers(data);
  }
}
