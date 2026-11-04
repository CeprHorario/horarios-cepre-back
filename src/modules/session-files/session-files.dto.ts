import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  IsArray,
  ArrayMinSize,
  ArrayMaxSize,
  IsIn,
  Matches,
  ValidateNested,
} from 'class-validator';
import { plainToInstance, Transform } from 'class-transformer';
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
export class SessionFileUploadDto {
  @IsOptional() @IsString() @MaxLength(2000) reason?: string;
}
export class ThumbnailReferenceDto {
  @IsInt() @Min(1) recordId: number;
  @IsIn(['initial', 'final']) slot: 'initial' | 'final';
  @IsUUID() fileId: string;
  @IsString() @Matches(/^\d{1,32}$/) generation: string;
}
export class ThumbnailsQueryDto {
  @Transform(({ value }: { value: unknown }) => {
    if (Array.isArray(value))
      return plainToInstance(ThumbnailReferenceDto, value);
    if (typeof value !== 'string' || value.length > 16384) return null;
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed)
        ? plainToInstance(ThumbnailReferenceDto, parsed)
        : null;
    } catch {
      return null;
    }
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(32)
  @ValidateNested({ each: true })
  refs: ThumbnailReferenceDto[];
}
export class AdministrativeCaptureDto extends AssociateSessionCaptureDto {
  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  declare reason: string;
}
