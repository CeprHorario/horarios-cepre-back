import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ObservationBaseDto } from './index';

export class AdmissionDto {
  @IsNotEmpty()
  @IsNumber()
  id!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  name: string;

  @IsBoolean()
  @IsOptional()
  isCurrent?: boolean;

  @IsNumber()
  @IsNotEmpty()
  @Min(2020)
  @Max(2100)
  year: number;

  @IsDate()
  @IsNotEmpty()
  @Type(() => Date)
  started: Date;

  @IsDate()
  @IsNotEmpty()
  @Type(() => Date)
  finished: Date;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @IsDate()
  @Type(() => Date)
  createdAt: Date;

  @IsOptional()
  observations?: ObservationBaseDto[];
}
