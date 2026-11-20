import { Type, Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class OperationPageDto {
  @Type(() => Number) @IsInt() @Min(1) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @IsOptional()
  @IsIn(['PENDING', 'ADMIN_PENDING', 'CHANGES', 'APPROVED', 'REJECTED', 'CANCELLED', 'SUPERSEDED'])
  status?: string;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
}
export class RequestContextDto {
  @IsOptional() @IsUUID('all') coverageOperationId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) candidateShiftId?: number;
  @IsOptional() @IsBoolean() @Transform(({value}: {value:unknown}) => value === 'true' ? true : value === 'false' ? false : value) sameTurn?: boolean;
  @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) date: string;
  @IsOptional() @IsIn(['NORMAL', 'EMERGENCY']) kind: 'NORMAL' | 'EMERGENCY' =
    'NORMAL';
  @IsOptional() @IsUUID('all') classId?: string;
}
export class ReplacementDraftDto extends RequestContextDto {
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(5)
  @IsString({each:true}) @MinLength(3,{each:true}) @MaxLength(160,{each:true})
  annexDescriptions?: string[];
  @IsOptional() @IsString() @MaxLength(2000) sameTurnReason?: string;
  @IsOptional() @IsString() @MaxLength(250) address?: string;
  @IsOptional() @IsString() @MaxLength(100) district?: string;
  @IsOptional() @IsString() @MaxLength(30) cui?: string;
  @IsOptional() @IsUUID('all') revisesId?: string;
  @IsUUID('all') operationId: string;
  @IsUUID('all') replacementUserId: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  hourSessionIds: number[];
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  reason: string;
  @IsBoolean() compress = false;
}
export class ReplacementCandidateDto extends RequestContextDto {
  @IsOptional() @IsString() @Matches(/^\d+(,\d+)*$/) hours?: string;
  @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
}
export class RequestDecisionDto {
  @IsInt() @Min(1) expectedVersion: number;
  @IsIn(['APPROVED', 'REJECTED', 'CHANGES', 'CANCELLED', 'REQUEST_CANCEL', 'APPROVE_CANCEL', 'REJECT_CANCEL']) status: string;
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}
export class TeachingReplacementQueryDto extends OperationPageDto {
  @IsDateString({strict:true}) @Matches(/^\d{4}-\d{2}-\d{2}$/) from:string;
  @IsDateString({strict:true}) @Matches(/^\d{4}-\d{2}-\d{2}$/) to:string;
}
export class PartObservationDto {
  @IsUUID('all') id: string;
  @IsIn(['TEACHER', 'STUDENT', 'CLASSROOM']) target:
    'TEACHER' | 'STUDENT' | 'CLASSROOM';
  @IsOptional() @IsString() @MaxLength(128) firstName?: string;
  @IsOptional() @IsString() @MaxLength(128) lastName?: string;
  @IsString() @MinLength(3) @MaxLength(2000) description: string;
}
export class ReportQueryDto extends OperationPageDto {
  @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) from: string;
  @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) to: string;
  @IsOptional()
  @IsIn(['incidences', 'requests', 'performance', 'observations'])
  type = 'incidences';
  @IsOptional()
  @IsIn([
    'profesor',
    'monitor',
    'supervisor',
    'coordinador',
    'administrador',
    'STUDENT',
    'CLASSROOM',
  ])
  role?: string;
}
