import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

/** Cuerpo de las eliminaciones lógicas en bloque (PATCH /<recurso>/deactivate) */
export class DeactivateManyDto {
  @ApiProperty({
    type: [String],
    example: ['3b9d5f9d-79fc-45c5-8e8b-7ee70cdd1ab1'],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  ids: string[];
}

export class DeactivateManyResultDto {
  @ApiProperty({ example: 3 })
  deactivated: number;
}
