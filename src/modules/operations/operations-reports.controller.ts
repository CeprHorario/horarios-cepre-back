import {reportColumns} from './report-columns';
import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Req,
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Response } from 'express';
import ExcelJS from 'exceljs';
import { Prisma } from '../../generated/prisma/client';
import {
  Authorization,
  Role,
} from '../auth/decorators/authorization.decorator';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { ClassSessionContextGuard } from '../class-session-records/class-session-context.guard';
import { OperationsContext } from './operations-context.service';
import { ReportQueryDto } from './operations.dto';
@Controller('operations/reports')
@UseGuards(ClassSessionContextGuard)
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class OperationsReportsController {
  constructor(private readonly contexts: OperationsContext) {}
  private async data(
    req: AuthenticatedRequest,
    q: ReportQueryDto,
    exporting = false,
  ) {
    const ctx = await this.contexts.get(req.user);
    if (ctx.actor.role !== Role.ADMIN)
      throw new BadRequestException('Solo administración consulta reportes');
    const diff = Date.parse(q.to) - Date.parse(q.from);
    if (!Number.isFinite(diff) || diff < 0 || diff > 93 * 86400000)
      throw new BadRequestException('Selecciona un rango de hasta 93 días');
    const from = new Date(q.from + 'T00:00:00-05:00'),
      end = new Date(Date.parse(q.to + 'T00:00:00-05:00') + 86400000);
    const limit = exporting ? 10001 : q.limit,
      offset = exporting ? 0 : (q.page - 1) * q.limit;
    return ctx.client.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SET LOCAL search_path TO ${Prisma.raw('"' + ctx.schema + '"')}, public`,
      );
      let rows: Record<string, unknown>[];
      if (q.type === 'requests')
        rows =
          await tx.$queryRaw`SELECT id,date,subject_role,kind,status,reason,decision_reason,blocks,pdf_size,created_at FROM replacement_requests WHERE date>=${new Date(q.from)}::date AND date<=${new Date(q.to)}::date ORDER BY date DESC,id LIMIT ${limit} OFFSET ${offset}`;
      else if (q.type === 'performance')
        rows =
          await tx.$queryRaw`WITH assignments AS (SELECT rec.id,rec.scheduled_start,rec.scheduled_end,rec.class_state,rec.actual_start,rec.actual_end,rec.incidents,person.role,person.user_id FROM class_session_records rec CROSS JOIN LATERAL (SELECT 'profesor' AS role,t.user_id FROM teachers t WHERE t.id=rec.titular_teacher_id UNION ALL SELECT 'monitor',m.user_id FROM monitors m WHERE m.id=rec.titular_monitor_id UNION ALL SELECT 'supervisor',s.user_id FROM supervisors s WHERE s.id=rec.supervisor_id) person WHERE rec.date>=${new Date(q.from)}::date AND rec.date<=${new Date(q.to)}::date AND rec.deleted_at IS NULL) SELECT a.role,p.dni,concat_ws(' ',p.first_name,p.last_name) AS nombre,u.email,count(*)::int AS bloques,round(sum(extract(epoch FROM(a.scheduled_end-a.scheduled_start))/60)::numeric,2)::float8 AS minutos_programados,CASE WHEN a.role='profesor' THEN count(*) FILTER(WHERE a.class_state='T')::int ELSE NULL END AS tardanzas,CASE WHEN a.role='profesor' THEN count(*) FILTER(WHERE a.class_state='SD')::int ELSE NULL END AS sin_docente,CASE WHEN a.role='profesor' THEN count(*) FILTER(WHERE a.class_state='RN')::int ELSE NULL END AS reemplazos_normales,CASE WHEN a.role='profesor' THEN count(*) FILTER(WHERE a.class_state='RE')::int ELSE NULL END AS reemplazos_emergencia,count(*) FILTER(WHERE a.actual_start IS NULL OR a.actual_end IS NULL)::int AS control_incompleto,(SELECT count(*)::int FROM public.person_incidences i WHERE i.subject_dni=p.dni AND i.subject_role=a.role AND i.process_schema=${ctx.schema} AND i.occurred_at>=${from} AND i.occurred_at<${end}) AS incidencias_personales FROM assignments a JOIN users u ON u.id=a.user_id LEFT JOIN user_profiles p ON p.user_id=u.id GROUP BY a.role,p.dni,p.first_name,p.last_name,u.email ORDER BY a.role,nombre LIMIT ${limit} OFFSET ${offset}`;
      else if (q.type === 'observations')
        rows =
          await tx.$queryRaw`SELECT rec.date,rec.id AS parte,rec.class_id,o->>'target' AS destinatario,o->>'firstName' AS nombres,o->>'lastName' AS apellidos,o->>'description' AS observacion FROM class_session_records rec CROSS JOIN jsonb_array_elements(rec.structured_observations) o WHERE rec.deleted_at IS NULL AND rec.date>=${new Date(q.from)}::date AND rec.date<=${new Date(q.to)}::date ORDER BY rec.date DESC,rec.id LIMIT ${limit} OFFSET ${offset}`;
      else
        rows =
          await tx.$queryRaw`SELECT subject_dni,subject_role,subject_name,process_schema,record_id,class_id,title,description,occurred_at,status,version FROM public.person_incidences WHERE process_schema=${ctx.schema} AND occurred_at>=${from} AND occurred_at<${end} ${q.role ? Prisma.sql`AND subject_role=${q.role}` : Prisma.empty} ORDER BY occurred_at DESC,id DESC LIMIT ${limit} OFFSET ${offset}`;
      if (exporting && rows.length > 10000)
        throw new BadRequestException(
          'El reporte supera 10000 filas; reduce el rango',
        );
      return rows;
    });
  }
  @Get()
  @Authorization({ adminOnly: true, permission: 'operations.reports.list' })
  async list(@Req() req: AuthenticatedRequest, @Query() q: ReportQueryDto) {
    const data = await this.data(req, q);
    return {
      data,
      page: q.page,
      limit: q.limit,
      hasNext: data.length === q.limit,
    };
  }
  @Get('excel')
  @Authorization({ adminOnly: true, permission: 'operations.reports.export' })
  async excel(
    @Req() req: AuthenticatedRequest,
    @Query() q: ReportQueryDto,
    @Res() res: Response,
  ) {
    const rows = await this.data(req, q, true);
    const book = new ExcelJS.Workbook(),
      guide = book.addWorksheet('Guía');
    guide.columns = [{ width: 32 }, { width: 100 }];
    guide.addRow(['CEPRUNSA · REPORTE', q.type]);
    guide.addRow(['Periodo', q.from + ' al ' + q.to]);
    guide.addRow([
      'Criterios',
      'Datos registrados. No se infieren asistencias, justificaciones ni sanciones.',
    ]);
    guide.addRow([
      'Horas',
      'Se exportan minutos programados reales del proceso; no se presume una duración fija de hora pedagógica.',
    ]);
    guide.addRow([
      'Incidencias',
      'Historial identificado por DNI. Las correcciones conservan el texto original y eventos auditados.',
    ]);
    const groups =
      q.type === 'performance'
        ? ['profesor', 'monitor', 'supervisor']
        : ['Registro'];
    for (const group of groups) {
      const data =
        q.type === 'performance' ? rows.filter((r) => r.role === group) : rows;
      const s = book.addWorksheet(
        (
          {
            profesor: 'Personal docente',
            monitor: 'Personal monitor',
            supervisor: 'Personal supervisor',
          } as Record<string, string>
        )[group] ?? group,
        { views: [{ state: 'frozen', ySplit: 1 }] },
      );
      const keys = Object.keys(data[0] ?? { resultado: '' });
      s.columns = keys.map((key) => ({
        header: reportColumns[key] ?? key.replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase()),
        key,
        width: key === 'description' || key === 'reason' ? 60 : 24,
      }));
      for (const row of data)
        s.addRow(
          Object.fromEntries(
            keys.map((k) => [
              k,
              row[k] instanceof Date
                ? row[k].toISOString()
                : typeof row[k] === 'object'
                  ? JSON.stringify(row[k])
                  : row[k],
            ]),
          ),
        );
      s.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      s.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF202343' },
      };
      s.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: Math.max(1, s.rowCount), column: keys.length },
      };
      s.eachRow((r) => {
        r.alignment = { wrapText: true, vertical: 'top' };
      });
    }
    res
      .set({
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Reporte-${q.type}.xlsx"`,
        'Cache-Control': 'private, no-store',
      })
      .send(Buffer.from(await book.xlsx.writeBuffer()));
  }
}
