import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsUUID,
  IsArray,
  IsEnum,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Weekday } from '../../../generated/prisma/client';

export class AvailabilityIntervalDto {
  @IsEnum(Weekday)
  weekday!: Weekday;

  @Matches(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
  start!: string;

  @Matches(/^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/)
  end!: string;
}

export class SaveAvailabilityDto {
  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => AvailabilityIntervalDto)
  intervals!: AvailabilityIntervalDto[];
}

export class ClearAvailabilityDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  teacherIds!: string[];
}
