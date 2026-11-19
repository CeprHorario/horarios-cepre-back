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
import { Observable } from 'rxjs';
import { ModuleRef } from '@nestjs/core';
import { RequestContext } from '@database/schema-manager/request-context';
import { RuntimeConfigService } from '../runtime-config/runtime-config.service';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { parseCoordinatorRole } from '../auth/utils/coordinator-role';
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
  TeachingReplacementQueryDto,
} from './operations.dto';
import { OperationsService } from './operations.service';
const roles = [Role.ADMIN, Role.TEACHER, Role.MONITOR, Role.SUPERVISOR, Role.COORDINATOR];
const notificationRoles = [...roles, Role.COORDINATOR];
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
  constructor(private readonly service: OperationsService, private readonly modules: ModuleRef) {}
  @Get('notifications/context')
  @Authorization({ roles: notificationRoles, permission: 'operations.notifications.context' })
  async notificationContext(@Req() req: AuthenticatedRequest) {
    const ctx = await this.service.contexts.get(req.user);
    return { accountId: ctx.user.id, role: parseCoordinatorRole(ctx.user.role).isCoordinator ? Role.COORDINATOR : ctx.user.role, process: ctx.schema };
  }
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
  @Get('teaching-replacements')
  @Authorization({roles:[Role.TEACHER],permission:'operations.teaching-replacements'})
  teachingReplacements(@Req() req:AuthenticatedRequest,@Query() q:TeachingReplacementQueryDto) {return this.service.teachingReplacements(req.user,q);}
  @Get('document-pending')
  @Authorization({roles:[Role.TEACHER,Role.MONITOR],permission:'operations.requests.pending-documents'})
  pendingDocuments(@Req() req:AuthenticatedRequest){return this.service.pendingDocuments(req.user);}
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
    roles: [Role.TEACHER, Role.MONITOR, Role.SUPERVISOR, Role.COORDINATOR],
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
  @Post('requests/preview')
  @Authorization({roles:[Role.TEACHER,Role.MONITOR,Role.SUPERVISOR,Role.COORDINATOR],permission:'operations.requests.preview'})
  @UseInterceptors(FilesInterceptor('evidence',5,{limits:{files:5,fileSize:8*1024*1024,fields:1,fieldSize:32*1024}}))
  async preview(@Req() req:AuthenticatedRequest,@Body('data') data:string,@UploadedFiles() files:Express.Multer.File[],@Res() res:Response) {
    let body:unknown;try{body=JSON.parse(data);}catch{throw new BadRequestException('Formulario inválido');}
    if(!body||typeof body!=='object'||Array.isArray(body))throw new BadRequestException('Formulario inválido');
    const dto=plainToInstance(ReplacementDraftDto,body),errors=await validate(dto,{whitelist:true,forbidNonWhitelisted:true});
    if(errors.length)throw new BadRequestException(errors.flatMap(e=>Object.values(e.constraints??{})).join('; '));
    const bytes=await this.service.create(req.user,dto,files??[],true);
    res.set({'Content-Type':'application/pdf','Content-Disposition':'inline; filename="Vista-previa-solicitud.pdf"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}).send(bytes);
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
  @Get('requests/:id/docx')
  @Authorization({roles,permission:'operations.requests.docx'})
  async word(@Req() req:AuthenticatedRequest,@Param('id',ParseUUIDPipe) id:string,@Res() res:Response) {
    const bytes=await this.service.word(req.user,id);
    res.set({'Content-Type':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','Content-Disposition':`attachment; filename="solicitud-${id}.docx"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}).send(bytes);
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
  @Authorization({ roles: notificationRoles, permission: 'operations.notifications.list' })
  notifications(
    @Req() req: AuthenticatedRequest,
    @Query() q: OperationPageDto,
  ) {
    return this.service.notifications(req.user, q);
  }
  @Post('notifications/resolve-all')
  @Authorization({ roles: notificationRoles, permission: 'operations.notifications.resolve-all' })
  resolveAll(@Req() req: AuthenticatedRequest) {
    return this.service.resolveNotifications(req.user);
  }
  @Post('notifications/:id/resolve')
  @Authorization({ roles: notificationRoles, permission: 'operations.notifications.resolve' })
  resolve(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.resolveNotifications(req.user, id);
  }
  @Sse('notifications/stream')
  @Authorization({ roles: notificationRoles, permission: 'operations.notifications.stream' })
  stream(@Req() req: AuthenticatedRequest): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let active = true;
      let timer: ReturnType<typeof setInterval> | undefined;
      let flushTimer: ReturnType<typeof setTimeout> | undefined;
      let chain = Promise.resolve();
      const records = new Map<number, number>();
      let snapshot = false;
      const state = this.modules.get(RequestContext, { strict: false }).require();
      const fail = () => {
        if (!active) return;
        subscriber.next({ type: 'context-changed', data: { refresh: true } });
        subscriber.complete();
      };
      const enqueue = (work: () => Promise<void>) => { chain = chain.then(async () => { if (active) await work(); }).catch(fail); };
      let unsubscribe = () => {};
      enqueue(async () => {
        const ctx = await this.service.contexts.get(req.user);
        const validate = async () => {
          const runtime = await this.modules.get(RuntimeConfigService, { strict: false }).getCurrent();
          const selected = req.user.role === String(Role.ADMIN) ? runtime?.schemaRouting.adminSchema : runtime?.schemaRouting.userSchema;
          if (!runtime || selected !== ctx.schema || (runtime.maintenance.enabled && req.user.role !== String(Role.ADMIN))) throw new Error('Contexto cambiado');
          state.runtime = runtime;
          state.routing = runtime.schemaRouting;
          await this.modules.get(JwtStrategy, { strict: false }).validate(req, { id: req.user.userId, role: req.user.role, email: req.user.email, schema: ctx.actor.origin, exp: req.user.expiresAt });
        };
        const sendSnapshot = async () => {
          await validate();
          const data = await this.service.notifications(req.user, { page: 1, limit: 20 });
          if (active) subscriber.next({ type: 'notifications', data: { ...data, context: { accountId: ctx.user.id, role: parseCoordinatorRole(ctx.user.role).isCoordinator ? Role.COORDINATOR : ctx.user.role, process: ctx.schema } } });
        };
        const subscription = this.service.changes.subscribe((event) => {
          if (event.transportDown) { subscriber.next({type:'stream-unavailable',data:{retry:true}}); subscriber.complete(); return; }
          if ((event.schema !== ctx.schema && !event.resync) || (event.recipientId !== '*' && (event.recipientId !== ctx.user.id || event.origin !== ctx.actor.origin))) return;
          if (event.recordId) records.set(event.recordId, event.version ?? 0);
          else snapshot = true;
          if (flushTimer) return;
          flushTimer = setTimeout(() => {
            flushTimer = undefined;
            const changed = [...records]; records.clear();
            const refresh = snapshot; snapshot = false;
            enqueue(async () => {
              await validate();
              if (refresh) await sendSnapshot();
              const permitted: { id: number; version: number }[] = [];
              if ([Role.ADMIN, Role.MONITOR, Role.SUPERVISOR].includes(ctx.actor.role)) {
                await this.service.streamRecords(ctx, changed, permitted);
              }
              if (active && (permitted.length || event.resync)) subscriber.next({ type: 'parts-changed', data: { accountId: ctx.user.id, process: ctx.schema, records: permitted, resync: Boolean(event.resync) } });
            });
          }, 75);
        });
        unsubscribe = () => subscription.unsubscribe();
        await this.service.listenerReady;
        if (!active) return;
        if (!this.service.listening) { subscriber.next({type:'stream-unavailable',data:{retry:true}}); subscriber.complete(); return; }
        await sendSnapshot();
        timer = setInterval(() => enqueue(async () => {
          await validate();
          if (active) subscriber.next({ type: 'heartbeat', data: { alive: true } });
        }), 25000);
      });
      return () => { active = false; unsubscribe(); clearInterval(timer); clearTimeout(flushTimer); };
    });
  }
}
