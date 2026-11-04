import { PartObservationDto } from '../operations/operations.dto';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
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
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class VersionDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion: number;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}
export class ReasonDto extends VersionDto {
  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  declare reason: string;
}
export class UpdateSessionDto extends VersionDto {
  @IsOptional() @IsEmail() @MaxLength(254) replacementEmail?: string;
  @IsOptional() @IsUUID() operationId?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PartObservationDto)
  structuredObservations?: PartObservationDto[];

  @ApiPropertyOptional({ nullable: true, enum: ['N', 'T', 'SD', 'RN', 'RE'] })
  @IsOptional()
  @IsIn(['N', 'T', 'SD', 'RN', 'RE'])
  classState?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  actualStart?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  actualEnd?: string | null;
  @ApiPropertyOptional({
    enum: ['UNCONFIRMED', 'TAUGHT', 'NOT_TAUGHT', 'INTERRUPTED'],
  })
  @IsOptional()
  @IsIn(['UNCONFIRMED', 'TAUGHT', 'NOT_TAUGHT', 'INTERRUPTED'])
  teachingStatus?: string;
  @ApiPropertyOptional({
    enum: ['UNKNOWN', 'PRESENT', 'ABSENT', 'PLANNED_REPLACEMENT'],
  })
  @IsOptional()
  @IsIn(['UNKNOWN', 'PRESENT', 'ABSENT', 'PLANNED_REPLACEMENT'])
  titularOutcome?: string;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  effectiveTeacherId?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  effectiveMonitorId?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  incidents?: string | null;
}
export class DateDto {
  @ApiProperty({ example: '2026-10-28' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  date: string;
}
export class SessionWorkspaceQueryDto {
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDateString() date?: string;
  @IsOptional() @IsUUID() classId?: string;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(32767)
  shiftId?: number;
}
export class MonitorJournalDto extends DateDto {
  @IsUUID() classId: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(32767) shiftId: number;
  @IsUUID() monitorId: string;
}
export class MonitorObservationQueryDto extends MonitorJournalDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
}
export class CreateMonitorObservationDto extends MonitorJournalDto {
  @IsString() @MinLength(3) @MaxLength(2000) text: string;
}
export class UpdateMonitorObservationDto extends CreateMonitorObservationDto {
  @IsInt() @Min(1) expectedVersion: number;
  @IsOptional() @IsString() @MaxLength(2000) reason?: string;
}
export class WithdrawMonitorObservationDto extends MonitorJournalDto {
  @IsInt() @Min(1) expectedVersion: number;
  @IsString() @MinLength(3) @MaxLength(2000) reason: string;
}
export class SessionJournalsQueryDto {
  @ApiProperty() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDateString() from: string;
  @ApiProperty() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDateString() to: string;
  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;
  @ApiPropertyOptional({ default: 25, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 25;
}
export class SessionQueryDto extends SessionJournalsQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() classId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() teacherId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() monitorId?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  shiftId?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  courseId?: number;
  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  includeDeleted?: string;
  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  pendingReview?: string;
}
export class RecoveryDto extends DateDto {
  @ApiProperty() @IsInt() @Min(1) originalRecordId: number;
  @ApiProperty() @IsUUID() classId: string;
  @ApiProperty() @IsInt() @Min(1) hourSessionId: number;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(2000) reason: string;
}
export class SessionPeopleQueryDto {
  @ApiProperty({ enum: ['TEACHER', 'MONITOR'] })
  @IsIn(['TEACHER', 'MONITOR'])
  kind: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;
  @ApiPropertyOptional({ default: 25, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 25;
}
export class CoverageTargetDto extends VersionDto {
  @ApiProperty() @IsInt() @Min(1) recordId: number;
}
export class CoverageDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() operationId?: string;
  @ApiProperty({ type: [CoverageTargetDto], maxItems: 200 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CoverageTargetDto)
  targets: CoverageTargetDto[];
  @ApiProperty({ enum: ['TEACHER', 'MONITOR'] })
  @IsIn(['TEACHER', 'MONITOR'])
  kind: string;
  @ApiProperty() @IsUUID() personId: string;
  @ApiProperty({ enum: ['PLANNED', 'EMERGENCY'] })
  @IsIn(['PLANNED', 'EMERGENCY'])
  mode: string;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(2000) reason: string;
}
export class ResolveCoverageDto extends ReasonDto {
  @ApiProperty({ enum: ['AUTHORIZED', 'REJECTED', 'REVOKED'] })
  @IsIn(['AUTHORIZED', 'REJECTED', 'REVOKED'])
  status: string;
}
export class GrantDto extends ReasonDto {
  @ApiProperty() @IsUUID() accountId: string;
  @ApiProperty() @IsDateString() expiresAt: string;
}
export class ReviewDto extends VersionDto {
  @ApiProperty({ enum: ['CONFORMING', 'OBSERVED'] })
  @IsIn(['CONFORMING', 'OBSERVED'])
  result: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  comments?: string;
  @ApiProperty({
    description: 'Confirmación explícita, no prueba de atención humana',
  })
  @IsIn([true])
  confirmed: boolean;
}
export class OperationalConfigDto extends ReasonDto {
  @ApiProperty() @IsBoolean() enabled: boolean;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  startsOn?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString()
  endsOn?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  latenessToleranceMinutes?: number | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  replacementWaitMinutes?: number | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  alertThresholdMinutes?: number | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  escalationDelayMinutes?: number | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  continuityGapMinutes?: number | null;
}
