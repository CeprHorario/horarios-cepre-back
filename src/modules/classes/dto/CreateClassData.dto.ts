import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNumber } from 'class-validator';

const validAreas: number[] = [1, 2, 3];
const validShifts: number[] = [1, 2, 3];

export class CreateClassDataDto {
  @IsNumber()
  @IsIn(validAreas)
  @ApiProperty({ example: validAreas[0] })
  area_id: number;

  @IsNumber()
  @IsIn(validShifts)
  @ApiProperty({ example: validShifts[0] })
  shift_id: number;
}
