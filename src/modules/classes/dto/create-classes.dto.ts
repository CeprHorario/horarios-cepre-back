import { PickType } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';
import { CreateClassDataDto } from './CreateClassData.dto';

export class CreateClassesDto extends PickType(CreateClassDataDto, [
  'area_id',
  'shift_id',
] as const) {
  @IsInt()
  @Min(1)
  @Max(500)
  quantity!: number;
}
