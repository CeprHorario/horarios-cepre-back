import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { Authorization } from '@modules/auth/decorators/authorization.decorator';
import { ImportsService } from './imports.service';
import { importKind } from './workbook';
import { importColumns } from './columns';

@Controller('imports')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Get(':kind/columns')
  @Authorization({
    adminOnly: true,
    permission: 'imports.template',
    description: 'Cabeceras y formatos de importación',
  })
  columns(@Param('kind') kind: string) {
    return importColumns(importKind(kind));
  }

  @Get(':kind/template')
  @Authorization({
    adminOnly: true,
    permission: 'imports.template',
    description: 'Plantillas de importación',
  })
  async template(@Param('kind') kind: string, @Res() response: Response) {
    const buffer = await this.imports.template(importKind(kind));
    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="plantilla_${kind}.xlsx"`,
    );
    response.send(buffer);
  }

  @Post(':kind/preview')
  @HttpCode(200)
  @Authorization({
    adminOnly: true,
    permission: 'imports.preview',
    description: 'Validar lote sin modificar datos',
  })
  @UseInterceptors(
    FileInterceptor('archivo', {
      limits: {
        fileSize: 8 * 1024 * 1024,
        files: 1,
        fields: 1,
        fieldSize: 64,
        fieldNameSize: 32,
        parts: 2,
      },
    }),
  )
  preview(
    @Param('kind') kind: string,
    @UploadedFile() file: { buffer: Buffer; originalname: string },
  ) {
    if (!file) throw new BadRequestException('Selecciona un archivo');
    return this.imports.preview(
      importKind(kind),
      file.buffer,
      file.originalname,
    );
  }

  @Post(':kind/apply')
  @HttpCode(200)
  @Authorization({
    adminOnly: true,
    permission: 'imports.apply',
    description: 'Aplicar lote atómico',
  })
  @UseInterceptors(
    FileInterceptor('archivo', {
      limits: {
        fileSize: 8 * 1024 * 1024,
        files: 1,
        fields: 1,
        fieldSize: 64,
        fieldNameSize: 32,
        parts: 2,
      },
    }),
  )
  apply(
    @Param('kind') kind: string,
    @UploadedFile() file: { buffer: Buffer; originalname: string },
    @Body('schema') schema: string,
  ) {
    if (!file || !schema)
      throw new BadRequestException(
        'Valida el archivo y el proceso antes de confirmar',
      );
    return this.imports.apply(
      importKind(kind),
      file.buffer,
      file.originalname,
      schema,
    );
  }
}
