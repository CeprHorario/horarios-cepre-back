import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Req,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import {
  Authorization,
  Role,
} from '@modules/auth/decorators/authorization.decorator';
import { SessionPrincipal } from '../class-session-records/session.types';
import {
  AdministrativeCaptureDto,
  AdministrativeFileUploadDto,
  AssociateSessionCaptureDto,
} from './session-files.dto';
import {
  ApiTags,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
  ApiOperation,
} from '@nestjs/swagger';
import { SessionFilesService } from './session-files.service';
import { MAX_SESSION_FILE_SIZE } from './session-file.validation';
import { ClassSessionContextGuard } from '../class-session-records/class-session-context.guard';

@Controller('class-session-files')
@ApiTags('Evidencias de partes')
@ApiBearerAuth()
@UseGuards(ClassSessionContextGuard)
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class SessionFilesController {
  constructor(private readonly files: SessionFilesService) {}

  @Post('records/:recordId')
  @Authorization({
    roles: [Role.MONITOR, Role.ADMIN],
    permission: 'class-session-files.upload',
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_SESSION_FILE_SIZE, files: 1, fields: 0 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  upload(
    @Req() request: Request & { user: SessionPrincipal },
    @Param('recordId', ParseIntPipe) recordId: number,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.files.upload(request.user, recordId, file);
  }

  @Get(':fileId/content')
  @ApiOperation({
    summary: 'Solicitud autenticada de acceso a evidencia, sin caché',
  })
  @Authorization({
    roles: [Role.MONITOR, Role.SUPERVISOR, Role.ADMIN],
    permission: 'class-session-files.content',
  })
  async content(
    @Req() request: Request & { user: SessionPrincipal },
    @Param('fileId', ParseUUIDPipe) fileId: string,
  ) {
    const { file, bytes } = await this.files.content(request.user, fileId);
    request.res?.setHeader('Cache-Control', 'private, no-store');
    request.res?.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(bytes, {
      type: file.contentType,
      length: bytes.length,
      disposition: `attachment; filename="capture.png"; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
    });
  }

  @Post('records/:recordId/captures/:slot')
  @Authorization({
    roles: [Role.MONITOR, Role.ADMIN],
    permission: 'class-session-files.associate',
  })
  associate(
    @Req() request: Request & { user: SessionPrincipal },
    @Param('recordId', ParseIntPipe) recordId: number,
    @Param('slot') slot: string,
    @Body() dto: AssociateSessionCaptureDto,
  ) {
    return this.files.associate(request.user, recordId, slot, dto);
  }

  @Post('records/:recordId/corrections/upload')
  @Authorization({
    adminOnly: true,
    permission: 'class-session-files.corrections.upload',
  })
  @ApiOperation({
    summary:
      'Subida administrativa extraordinaria, motivo obligatorio, no reabre el plazo',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'reason'],
      properties: {
        file: { type: 'string', format: 'binary' },
        reason: { type: 'string', minLength: 3, maxLength: 2000 },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: MAX_SESSION_FILE_SIZE,
        files: 1,
        fields: 1,
        fieldSize: 8000,
      },
    }),
  )
  uploadCorrection(
    @Req() request: Request & { user: SessionPrincipal },
    @Param('recordId', ParseIntPipe) recordId: number,
    @Body() dto: AdministrativeFileUploadDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.files.upload(request.user, recordId, file, true, dto.reason);
  }

  @Post('records/:recordId/corrections/captures/:slot')
  @Authorization({
    adminOnly: true,
    permission: 'class-session-files.corrections.associate',
  })
  @ApiOperation({
    summary:
      'Asociación/sustitución administrativa extraordinaria con versión y motivo',
  })
  associateCorrection(
    @Req() request: Request & { user: SessionPrincipal },
    @Param('recordId', ParseIntPipe) recordId: number,
    @Param('slot') slot: string,
    @Body() dto: AdministrativeCaptureDto,
  ) {
    return this.files.associate(request.user, recordId, slot, dto, true);
  }
}
