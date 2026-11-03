import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray } from 'class-validator';

import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class IncidenceDniSummaryDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @Matches(/^\d{8}$/, { each: true })
  dnis: string[];
}

export class IncidencePeopleQuery {
  @IsIn(['profesor', 'monitor', 'supervisor', 'coordinador', 'administrador']) subjectRole: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) recordId?: number;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @Type(() => Number) @IsInt() @Min(1) page = 1;
}
export class CreateIncidenceDto {
  @IsUUID('all') operationId: string;
  @IsUUID('all') subjectAccountId: string;
  @IsIn(['profesor', 'monitor', 'supervisor', 'coordinador', 'administrador']) subjectRole: string;
  @IsOptional() @IsInt() @Min(1) recordId?: number;
  @IsString() @MinLength(3) @MaxLength(120) title: string;
  @IsString() @MinLength(3) @MaxLength(4000) description: string;
  @IsISO8601() occurredAt: string;
}
export class IncidenceQuery {
  @IsOptional() @Matches(/^\d{8}$/) dni?: string;
  @IsOptional() @IsIn(['OPEN', 'RESOLVED']) status?: string;
  @Type(() => Number) @IsInt() @Min(1) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
}
export class ResolveIncidenceDto {
  @IsInt() @Min(1) expectedVersion: number;
  @IsIn(['OPEN', 'RESOLVED']) status: string;
  @IsString() @MinLength(3) @MaxLength(2000) reason: string;
}
