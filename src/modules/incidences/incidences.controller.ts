import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ClassSessionContextGuard } from '../class-session-records/class-session-context.guard';
import {
  Authorization,
  Role,
} from '@modules/auth/decorators/authorization.decorator';
import type { AuthenticatedRequest } from '@modules/auth/authenticated-request';
import {
  CreateIncidenceDto,
  IncidencePeopleQuery,
  IncidenceDniSummaryDto,
  IncidenceQuery,
  ResolveIncidenceDto,
} from './incidences.dto';
import { IncidencesService } from './incidences.service';
const roles = [Role.ADMIN, Role.MONITOR, Role.SUPERVISOR];

@Controller('incidences')
@UseGuards(ClassSessionContextGuard)
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class IncidencesController {
  constructor(private readonly service: IncidencesService) {}
  @Get('context')
  @Authorization({roles:[Role.ADMIN, Role.SUPERVISOR, Role.COORDINATOR], permission:'incidences.context'})
  context(@Req() req: AuthenticatedRequest) {
    return this.service.readContext(req.user);
  }
  @Post('dni-summary')
  @Authorization({ adminOnly: true, permission: 'incidences.dni-summary' })
  dniSummary(
    @Req() req: AuthenticatedRequest,
    @Body() dto: IncidenceDniSummaryDto,
  ) {
    return this.service.dniSummary(req.user, dto.dnis);
  }
  @Get('people')
  @Authorization({ roles, permission: 'incidences.people' })
  people(
    @Req() req: AuthenticatedRequest,
    @Query() query: IncidencePeopleQuery,
  ) {
    return this.service.people(req.user, query);
  }
  @Get('warnings')
  @Authorization({ adminOnly: true, permission: 'incidences.warnings' })
  warnings(@Req() req: AuthenticatedRequest) {
    return this.service.warnings(req.user);
  }
  @Get()
  @Authorization({
    roles: [Role.ADMIN, Role.SUPERVISOR, Role.COORDINATOR],
    permission: 'incidences.list',
  })
  list(@Req() req: AuthenticatedRequest, @Query() query: IncidenceQuery) {
    return this.service.list(req.user, query);
  }
  @Post()
  @Authorization({ roles, permission: 'incidences.create' })
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateIncidenceDto) {
    return this.service.create(req.user, dto);
  }
  @Get(':id/history')
  @Authorization({ adminOnly: true, permission: 'incidences.history' })
  history(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.history(req.user, id);
  }
  @Patch(':id')
  @Authorization({ adminOnly: true, permission: 'incidences.resolve' })
  resolve(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveIncidenceDto,
  ) {
    return this.service.resolve(req.user, id, dto);
  }
}
