import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class MaintenanceConfigDto {
  @IsBoolean()
  enabled: boolean;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  message: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsISO8601()
  endsAt?: string | null;
}

export class SchemaRoutingConfigDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(48)
  adminSchema: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(48)
  userSchema: string;
}

export class UpdateRuntimeConfigDto {
  @IsInt()
  @Min(1)
  expectedVersion: number;

  @ValidateNested()
  @Type(() => MaintenanceConfigDto)
  maintenance: MaintenanceConfigDto;

  @ValidateNested()
  @Type(() => SchemaRoutingConfigDto)
  schemaRouting: SchemaRoutingConfigDto;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  changeReason: string;
}
