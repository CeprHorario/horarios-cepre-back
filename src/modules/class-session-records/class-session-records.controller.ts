import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Authorization,
  Role,
} from '@modules/auth/decorators/authorization.decorator';
import { ClassSessionRecordsService } from './class-session-records.service';
import { SessionJournalService } from './session-journal.service';
import { SessionFollowupService } from './session-followup.service';
import { SessionReportsService } from './session-reports.service';
import {
  CoverageDto,
  DateDto,
  GrantDto,
  OperationalConfigDto,
  ReasonDto,
  RecoveryDto,
  ResolveCoverageDto,
  ReviewDto,
  SessionQueryDto,
  UpdateSessionDto,
} from './session.dto';
import { SessionPrincipal } from './session.types';

type AuthRequest = { user: SessionPrincipal };
const readers = [Role.MONITOR, Role.SUPERVISOR];
@Controller('class-session-records')
@ApiTags('Partes operativos')
@ApiBearerAuth()
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class ClassSessionRecordsController {
  constructor(
    private readonly records: ClassSessionRecordsService,
    private readonly journal: SessionJournalService,
    private readonly followup: SessionFollowupService,
    private readonly reports: SessionReportsService,
  ) {}
  @Get('agenda')
  @Authorization({ roles: readers, permission: 'class-session-records.agenda' })
  @ApiOperation({
    summary: 'Agenda fechada; materializa solo bloques futuros de hoy',
  })
  agenda(@Req() req: AuthRequest, @Query() query: DateDto) {
    return this.journal.agenda(req.user, query.date);
  }
  @Get()
  @Authorization({ roles: readers, permission: 'class-session-records.list' })
  @ApiOperation({
    summary: 'Partes del recurso autorizado, rango máximo 93 días',
  })
  list(@Req() req: AuthRequest, @Query() query: SessionQueryDto) {
    return this.records.list(req.user, query);
  }
  @Post('recoveries')
  @Authorization({
    adminOnly: true,
    permission: 'class-session-records.recoveries',
  })
  @ApiOperation({
    summary: 'Programar recuperación excepcional fechada, incluidos domingos',
  })
  recovery(@Req() req: AuthRequest, @Body() dto: RecoveryDto) {
    return this.journal.recovery(req.user, dto);
  }
  @Post('replacements')
  @Authorization({
    roles: [Role.MONITOR],
    permission: 'class-session-records.replacements',
  })
  @ApiOperation({
    summary:
      'Cobertura individual/masiva por bloques; monitor solicita emergencia, administración autoriza',
  })
  cover(@Req() req: AuthRequest, @Body() dto: CoverageDto) {
    return this.journal.cover(req.user, dto);
  }
  @Post('replacements/:id/resolve')
  @Authorization({
    adminOnly: true,
    permission: 'class-session-records.replacements.resolve',
  })
  resolve(
    @Req() req: AuthRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResolveCoverageDto,
  ) {
    return this.journal.resolve(req.user, id, dto);
  }
  @Post('grants/:id/revoke')
  @Authorization({
    adminOnly: true,
    permission: 'class-session-records.grants.revoke',
  })
  revokeGrant(
    @Req() req: AuthRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReasonDto,
  ) {
    return this.journal.revokeGrant(req.user, id, dto);
  }
  @Get('configuration')
  @Authorization({
    adminOnly: true,
    permission: 'class-session-records.configuration.read',
  })
  config(@Req() req: AuthRequest) {
    return this.journal.configuration(req.user);
  }
  @Patch('configuration')
  @Authorization({
    adminOnly: true,
    permission: 'class-session-records.configuration.update',
  })
  updateConfig(@Req() req: AuthRequest, @Body() dto: OperationalConfigDto) {
    return this.journal.configuration(req.user, dto);
  }
  @Get('alerts')
  @Authorization({
    roles: [Role.SUPERVISOR],
    permission: 'class-session-records.alerts',
  })
  alerts(
    @Req() req: AuthRequest,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
  ) {
    return this.followup.alerts(req.user, Math.max(1, page));
  }
  @Post('alerts/:id/acknowledge')
  @Authorization({
    roles: [Role.SUPERVISOR],
    permission: 'class-session-records.alerts.acknowledge',
  })
  acknowledge(@Req() req: AuthRequest, @Param('id', ParseIntPipe) id: number) {
    return this.followup.acknowledge(req.user, id);
  }
  @Get('reports/detail')
  @Authorization({
    adminOnly: true,
    permission: 'class-session-records.reports.detail',
  })
  @ApiOperation({
    summary:
      'Una fila por parte, sin evidencias; seguimiento sin reglas de pago',
  })
  report(@Req() req: AuthRequest, @Query() query: SessionQueryDto) {
    return this.reports.report(req.user, query);
  }
  @Get('reports/summary')
  @Authorization({
    adminOnly: true,
    permission: 'class-session-records.reports.summary',
  })
  summary(@Req() req: AuthRequest, @Query() query: SessionQueryDto) {
    return this.reports.report(req.user, query, true);
  }
  @Get(':id/history')
  @Authorization({
    roles: readers,
    permission: 'class-session-records.history',
  })
  history(
    @Req() req: AuthRequest,
    @Param('id', ParseIntPipe) id: number,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
  ) {
    return this.records.history(req.user, id, Math.max(1, page));
  }
  @Get(':id')
  @Authorization({ roles: readers, permission: 'class-session-records.detail' })
  detail(@Req() req: AuthRequest, @Param('id', ParseIntPipe) id: number) {
    return this.records.detail(req.user, id);
  }
  @Patch(':id')
  @Authorization({
    roles: [Role.MONITOR],
    permission: 'class-session-records.update',
  })
  @ApiOperation({
    summary: 'Registro/corrección ordinaria con versión y cierre fijo',
  })
  update(
    @Req() req: AuthRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSessionDto,
  ) {
    return this.records.update(req.user, id, dto);
  }
  @Post(':id/corrections')
  @Authorization({
    adminOnly: true,
    permission: 'class-session-records.corrections',
  })
  @ApiOperation({
    summary:
      'Corrección administrativa extraordinaria motivada; no altera el cierre',
  })
  correct(
    @Req() req: AuthRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSessionDto,
  ) {
    return this.records.update(req.user, id, dto, true);
  }
  @Post(':id/cancel')
  @Authorization({
    adminOnly: true,
    permission: 'class-session-records.cancel',
  })
  cancel(
    @Req() req: AuthRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReasonDto,
  ) {
    return this.journal.cancel(req.user, id, dto);
  }
  @Post(':id/restore')
  @Authorization({
    adminOnly: true,
    permission: 'class-session-records.restore',
  })
  restore(
    @Req() req: AuthRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReasonDto,
  ) {
    return this.journal.cancel(req.user, id, dto, true);
  }
  @Post(':id/grants')
  @Authorization({
    adminOnly: true,
    permission: 'class-session-records.grants',
  })
  grant(
    @Req() req: AuthRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: GrantDto,
  ) {
    return this.journal.grant(req.user, id, dto);
  }
  @Post(':id/reviews')
  @Authorization({
    roles: [Role.SUPERVISOR],
    permission: 'class-session-records.reviews',
  })
  review(
    @Req() req: AuthRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReviewDto,
  ) {
    return this.journal.review(req.user, id, dto);
  }
}
