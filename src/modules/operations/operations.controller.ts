import {
  BadRequestException,
  Body,
  Controller,
  Get,
  MessageEvent,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  Sse,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { Response } from 'express';
import {
  Observable,
  catchError,
  filter,
  from,
  interval,
  map,
  merge,
  of,
  switchMap,
  takeUntil,
  timer,
} from 'rxjs';
import {
  Authorization,
  Role,
} from '../auth/decorators/authorization.decorator';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { ClassSessionContextGuard } from '../class-session-records/class-session-context.guard';
import {
  OperationPageDto,
  ReplacementCandidateDto,
  ReplacementDraftDto,
  RequestContextDto,
  RequestDecisionDto,
} from './operations.dto';
import { OperationsService } from './operations.service';
const roles = [Role.ADMIN, Role.TEACHER, Role.MONITOR, Role.SUPERVISOR];
@Controller('operations')
@UseGuards(ClassSessionContextGuard)
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class OperationsController {
  constructor(private readonly service: OperationsService) {}
  @Get('context')
  @Authorization({ roles, permission: 'operations.context' })
  context(@Req() req: AuthenticatedRequest) {
    return this.service.context(req.user);
  }
  @Get('classes')
  @Authorization({ roles, permission: 'operations.classes' })
  classes(@Req() req: AuthenticatedRequest, @Query() q: OperationPageDto) {
    return this.service.classes(req.user, q);
  }
  @Get('options')
  @Authorization({ roles, permission: 'operations.options' })
  options(@Req() req: AuthenticatedRequest, @Query() q: RequestContextDto) {
    return this.service.options(req.user, q);
  }
  @Get('candidates')
  @Authorization({ roles, permission: 'operations.candidates' })
  candidates(
    @Req() req: AuthenticatedRequest,
    @Query() q: ReplacementCandidateDto,
  ) {
    return this.service.candidates(req.user, q);
  }
  @Get('requests')
  @Authorization({ roles, permission: 'operations.requests.list' })
  list(@Req() req: AuthenticatedRequest, @Query() q: OperationPageDto) {
    return this.service.list(req.user, q);
  }
  @Post('requests')
  @Authorization({
    roles: [Role.TEACHER, Role.MONITOR, Role.SUPERVISOR],
    permission: 'operations.requests.create',
  })
  @UseInterceptors(
    FilesInterceptor('evidence', 5, {
      limits: {
        files: 5,
        fileSize: 8 * 1024 * 1024,
        fields: 1,
        fieldSize: 32 * 1024,
      },
    }),
  )
  async create(
    @Req() req: AuthenticatedRequest,
    @Body('data') data: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    let body: unknown;
    try {
      body = JSON.parse(data);
    } catch {
      throw new BadRequestException('Formulario inválido');
    }
    if(!body || typeof body!=='object' || Array.isArray(body))throw new BadRequestException('Formulario inválido');
    const dto = plainToInstance(ReplacementDraftDto, body);
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    if (errors.length)
      throw new BadRequestException(
        errors
          .map(
            (e) =>
              `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`,
          )
          .join('; '),
      );
    return this.service.create(req.user, dto, files ?? []);
  }
  @Get('requests/:id')
  @Authorization({ roles, permission: 'operations.requests.detail' })
  detail(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.detail(req.user, id);
  }
  @Get('requests/:id/pdf')
  @Authorization({ roles, permission: 'operations.requests.pdf' })
  async pdf(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const bytes = await this.service.pdf(req.user, id);
    res
      .set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="solicitud-${id}.pdf"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      .send(bytes);
  }
  @Patch('requests/:id')
  @Authorization({ roles, permission: 'operations.requests.decide' })
  decide(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RequestDecisionDto,
  ) {
    return this.service.decide(req.user, id, dto);
  }
  @Get('notifications')
  @Authorization({ roles, permission: 'operations.notifications.list' })
  notifications(
    @Req() req: AuthenticatedRequest,
    @Query() q: OperationPageDto,
  ) {
    return this.service.notifications(req.user, q);
  }
  @Post('notifications/resolve-all')
  @Authorization({ roles, permission: 'operations.notifications.resolve-all' })
  resolveAll(@Req() req: AuthenticatedRequest) {
    return this.service.resolveNotifications(req.user);
  }
  @Post('notifications/:id/resolve')
  @Authorization({ roles, permission: 'operations.notifications.resolve' })
  resolve(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.resolveNotifications(req.user, id);
  }
  @Sse('notifications/stream')
  @Authorization({ roles, permission: 'operations.notifications.stream' })
  stream(@Req() req: AuthenticatedRequest): Observable<MessageEvent> {
    return from(this.service.contexts.get(req.user)).pipe(
      switchMap((ctx) =>
        merge(
          of(0),
          interval(30000),
          this.service.changes.pipe(
            filter(
              (e) =>
                e.schema === ctx.schema &&
                (e.recipientId === '*' ||
                  (e.recipientId === ctx.user.id &&
                    e.origin === ctx.actor.origin)),
            ),
          ),
        ).pipe(
          switchMap(() =>
            this.service.notifications(req.user, { page: 1, limit: 20 }),
          ),
          map((data) => ({ type: 'notifications', data })),
        ),
      ),
      catchError(() =>
        of({ type: 'context-changed', data: { refresh: true } }),
      ),
      takeUntil(timer(60000)),
    );
  }
}
