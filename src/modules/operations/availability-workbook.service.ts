import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import ExcelJS from 'exceljs';
import { OperationsContext } from './operations-context.service';
import { SessionPrincipal } from '../class-session-records/session.types';
import { Role } from '../auth/decorators/authorization.decorator';
import { ScheduleService } from '../schedules/schedules.service';
import { SaveAvailabilityDto } from '../schedules/dto/availability.dto';
import { checkArchiveBudget } from '../imports/archive-budget';
const weekdays = [
  'Lunes',
  'Martes',
  'Miercoles',
  'Jueves',
  'Viernes',
  'Sabado',
] as const;
const days = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
@Injectable()
export class AvailabilityWorkbook {
  constructor(
    private readonly contexts: OperationsContext,
    private readonly schedules: ScheduleService,
  ) {}
  private async teacher(principal: SessionPrincipal, id: string) {
    const ctx = await this.contexts.get(principal);
    const t = await ctx.client.teacher.findFirst({
      where: {
        ...(id === 'me' ? { userId: ctx.user.id } : { id }),
        user: { isActive: true },
      },
      include: { user: { select: { email: true, userProfile: { select: { firstName: true, lastName: true } } } }, courses: { select: { name: true } } },
    });
    if (!t) throw new NotFoundException('Docente no encontrado');
    if (
      ctx.actor.role !== Role.ADMIN &&
      (ctx.actor.role !== Role.TEACHER || t.userId !== ctx.user.id)
    )
      throw new ForbiddenException('Solo puedes gestionar tu disponibilidad');
    return { ctx, t };
  }
  async template(principal: SessionPrincipal, id: string) {
    const { ctx, t } = id === 'general'
      ? { ctx: await this.contexts.get(principal), t: null }
      : await this.teacher(principal, id);
    if (!t && ctx.actor.role !== Role.ADMIN) throw new ForbiddenException('La plantilla general se descarga desde administración');
    const hours = await ctx.client.hourSession.findMany({
        include: { shift: true },
        orderBy: [{ shiftId: 'asc' }, { period: 'asc' }],
      });
    const book = new ExcelJS.Workbook();
    book.creator = 'CEPRUNSA';
    book.calcProperties.fullCalcOnLoad = true;
    const guide = book.addWorksheet('Guía');
    guide.columns = [{ width: 28 }, { width: 100 }];
    guide.addRow(['DISPONIBILIDAD DOCENTE', ctx.schema]);
    const personal = !!t;
    guide.addRow(['Docente (referencia)', personal ? [t.user.userProfile?.firstName, t.user.userProfile?.lastName].filter(Boolean).join(' ') || t.user.email : '']);
    guide.addRow(['Curso (referencia)', personal ? t.courses.name : '']);
    guide.addRow(['Destino', personal ? 'Completa tus bloques disponibles y sube este archivo en tu panel. Se guardará en tu cuenta. Tu nombre y curso son informativos.' : 'Esta plantilla puede distribuirse a todos los docentes del proceso. Nombres y curso son informativos; la carga se guarda en el docente seleccionado en el panel.']);
    guide.addRow([
      'Cómo llenar',
      'En Disponibilidad selecciona Disponible o No disponible por día y bloque. No cambies IDs, horas ni turnos.',
    ]);
    guide.addRow([
      'Cruces entre turnos',
      'Los bloques coincidentes representan el mismo tiempo: si seleccionas uno, se comparte la disponibilidad real con otros turnos.',
    ]);
    guide.addRow([
      'Guardar',
      personal ? 'Sube este archivo en tu panel y revisa tus nombres, curso y proceso antes de confirmar. Se reemplaza tu disponibilidad anterior; tus salones asignados se conservan.' : 'Carga el archivo desde el docente, revisa su nombre, curso y proceso en la confirmación. Reemplaza la disponibilidad anterior; conserva salones asignados.',
    ]);
    guide.addRow([
      'Colores',
      'Disponible se colorea de verde y No disponible de gris automáticamente al seleccionar el valor. El sistema lee el valor de la celda, no su relleno.',
    ]);
    const sheet = book.addWorksheet('Disponibilidad', {
      views: [{ state: 'frozen', xSplit: 4, ySplit: 1 }],
    });
    sheet.columns = [
      { header: 'Bloque ID', width: 13 },
      { header: 'Turno', width: 22 },
      { header: 'Hora Inicio', width: 16 },
      { header: 'Hora Fin', width: 16 },
      ...days.map((header) => ({ header, width: 22 })),
    ];
    for (const h of hours) {
      const start = h.startTime.toISOString().slice(11, 16),
        end = h.endTime.toISOString().slice(11, 16);
      const row = sheet.addRow([
        h.id,
        h.shift.name,
        start,
        end,
        ...weekdays.map(() => 'No disponible'),
      ]);
      for (let c = 5; c <= 10; c++)
        row.getCell(c).dataValidation = {
          type: 'list',
          allowBlank: false,
          formulae: ['"Disponible,No disponible"'],
          showErrorMessage: true,
          errorTitle: 'Valor inválido',
          error: 'Selecciona Disponible o No disponible.',
        };
    }
    sheet.addConditionalFormatting({
      ref: `E2:J${Math.max(2, sheet.rowCount)}`,
      rules: [
        {
          type: 'expression',
          formulae: ['OR(E2="Disponible",AND(ISLOGICAL(E2),E2=TRUE))'],
          priority: 1,
          style: {
            fill: {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFC6EFCE' },
            },
            font: { color: { argb: 'FF006100' }, bold: true },
          },
        },
        {
          type: 'expression',
          formulae: ['OR(E2="No disponible",AND(ISLOGICAL(E2),E2=FALSE))'],
          priority: 2,
          style: {
            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDEFF3' } },
            font: { color: { argb: 'FF727783' } },
          },
        },
      ],
    });
    for (const s of book.worksheets) {
      s.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      s.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF202343' },
      };
      s.getRow(1).height = 30;
      s.eachRow((r) => {
        r.alignment = { vertical: 'middle', wrapText: true };
      });
    }
    return Buffer.from(await book.xlsx.writeBuffer());
  }
  async preview(
    principal: SessionPrincipal,
    id: string,
    file: Express.Multer.File,
  ) {
    const { ctx, t } = await this.teacher(principal, id);
    if (!file?.buffer || file.size > 8 * 1024 * 1024)
      throw new BadRequestException('Adjunta un Excel de hasta 8 MB');
    const book = new ExcelJS.Workbook();
    try {
      await checkArchiveBudget(file.buffer);
      await book.xlsx.load(
        file.buffer as unknown as Parameters<typeof book.xlsx.load>[0],
      );
    } catch {
      throw new BadRequestException('No se pudo leer el Excel');
    }
    const guide = book.getWorksheet('Guía');
    if (guide?.getCell('B1').text !== ctx.schema)
      throw new BadRequestException(
        'La plantilla corresponde a otro proceso',
      );
    const sheet = book.getWorksheet('Disponibilidad');
    if (!sheet || sheet.rowCount > 2001)
      throw new BadRequestException('Hoja de disponibilidad inválida');
    const hours = await ctx.client.hourSession.findMany({
      include: { shift: true },
    });
    const expected = new Map(hours.map((h) => [h.id, h]));
    const seen = new Set<number>();
    const rows: {
      row: number;
      block: number;
      start: string;
      end: string;
      values: string[];
      errors: string[];
    }[] = [];
    const intervals: SaveAvailabilityDto['intervals'] = [];
    sheet.eachRow((r, n) => {
      if (n === 1) return;
      const block = Number(r.getCell(1).value),
        h = expected.get(block),
        errors: string[] = [];
      const start = r.getCell(3).text,
        end = r.getCell(4).text;
      if (!h || seen.has(block))
        errors.push(`A${n}: bloque desconocido o duplicado`);
      seen.add(block);
      if (
        h &&
        (start !== h.startTime.toISOString().slice(11, 16) ||
          end !== h.endTime.toISOString().slice(11, 16) ||
          r.getCell(2).text !== h.shift.name)
      )
        errors.push(`B${n}:D${n}: no modifiques turno ni horas`);
      const values = weekdays.map((day, i) => {
        const cell = r.getCell(i + 5),
          v = cell.value;
        const text =
          typeof v === 'boolean'
            ? v
              ? 'disponible'
              : 'no disponible'
            : cell.text.trim().toLowerCase();
        if (
          ![
            'disponible',
            'no disponible',
            'true',
            'false',
            'sí',
            'si',
            'no',
          ].includes(text) ||
          (typeof v === 'object' && v !== null)
        ) {
          errors.push(
            `${String.fromCharCode(69 + i)}${n}: selecciona Disponible o No disponible`,
          );
          return cell.text;
        }
        if (['disponible', 'true', 'sí', 'si'].includes(text) && h)
          intervals.push({
            weekday: day,
            start: h.startTime.toISOString().slice(11, 16),
            end: h.endTime.toISOString().slice(11, 16),
          });
        return text;
      });
      rows.push({ row: n, block, start, end, values, errors });
    });
    if (seen.size !== hours.length)
      throw new BadRequestException(
        'Faltan bloques del proceso: descarga nuevamente la plantilla',
      );
    return {
      process: ctx.schema,
      teacherId: t.id,
      teacher: {
        id: t.id,
        name: [t.user.userProfile?.firstName, t.user.userProfile?.lastName].filter(Boolean).join(' ') || t.user.email,
        course: t.courses.name,
      },
      rows,
      intervals,
      valid: rows.every((r) => !r.errors.length),
    };
  }
  async save(
    principal: SessionPrincipal,
    id: string,
    data: SaveAvailabilityDto,
  ) {
    const { t } = await this.teacher(principal, id);
    return this.schedules.saveAvailability(t.id, data);
  }
}
