import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AssociateSessionCaptureDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion: number;

  @ApiProperty()
  @IsUUID()
  fileId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}

export class AdministrativeFileUploadDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(2000) reason: string;
}
export class AdministrativeCaptureDto extends AssociateSessionCaptureDto {
  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  declare reason: string;
}
