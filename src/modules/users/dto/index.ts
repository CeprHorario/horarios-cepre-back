import { OmitType } from '@nestjs/swagger';
import { UserDto } from './user.dto';

export class UserBaseDto extends OmitType(UserDto, ['password'] as const) {}

export class CreateUserDto extends OmitType(UserDto, [
  'id',
  'updatedAt',
  'createdAt',
  'lastLogin',
  'isActive',
  'password',
] as const) {}
