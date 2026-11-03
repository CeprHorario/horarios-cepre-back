import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import {
  Authorization,
  Role,
} from '../auth/decorators/authorization.decorator';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { ClassSessionContextGuard } from '../class-session-records/class-session-context.guard';
import { SaveAvailabilityDto } from '../schedules/dto/availability.dto';
import { AvailabilityWorkbook } from './availability-workbook.service';
const roles = [Role.ADMIN, Role.TEACHER];
@Controller('operations/availability')
@UseGuards(ClassSessionContextGuard)
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class AvailabilityWorkbookController {
  constructor(private readonly service: AvailabilityWorkbook) {}
  @Get(':id/template')
  @Authorization({ roles, permission: 'operations.availability.template' })
  async template(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    res
      .set({
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition':
          'attachment; filename="Disponibilidad-docente.xlsx"',
        'Cache-Control': 'private, no-store',
      })
      .send(await this.service.template(req.user, id));
  }
  @Post(':id/preview')
  @Authorization({ roles, permission: 'operations.availability.preview' })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 8 * 1024 * 1024, files: 1 },
    }),
  )
  preview(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.service.preview(req.user, id, file);
  }
  @Put(':id')
  @Authorization({ roles, permission: 'operations.availability.save' })
  save(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: SaveAvailabilityDto,
  ) {
    return this.service.save(req.user, id, body);
  }
}
