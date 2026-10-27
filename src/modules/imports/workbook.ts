import { BadRequestException, HttpException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { Readable } from 'node:stream';
import { checkArchiveBudget } from './archive-budget';

export const IMPORT_KINDS = [
  'docentes',
  'monitores',
  'supervisores',
  'disponibilidad',
  'retirar-disponibilidad',
  'desasignaciones',
] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];
export type RawRow = { line: number; values: Record<string, string> };
export const headers: Record<ImportKind, string[]> = {
  docentes: [
    'correo',
    'dni',
    'nombres',
    'apellidos',
    'correo_personal',
    'celular',
    'curso',
    'dedicacion',
    'horas_maximas',
    'celulares_adicionales',
  ],
  monitores: [
    'salon',
    'turno',
    'dni',
    'nombres',
    'apellidos',
    'correo_personal',
    'celular',
    'celulares_adicionales',
  ],
  supervisores: [
    'salon',
    'turno',
    'correo',
    'dni',
    'nombres',
    'apellidos',
    'correo_personal',
    'celular',
    'celulares_adicionales',
  ],
  disponibilidad: [
    'correo',
    'dia',
    'alcance',
    'turno',
    'hora_inicio',
    'hora_fin',
  ],
  'retirar-disponibilidad': [
    'correo',
    'dia',
    'alcance',
    'turno',
    'hora_inicio',
    'hora_fin',
  ],
  desasignaciones: ['correo', 'salon', 'turno'],
};
export const plain = (value: string) =>
  value
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
export const field = (value: string) => plain(value).replace(/\s+/g, '_');

export function importKind(value: string): ImportKind {
  if (value === 'retirar-disponibilidad')
    throw new BadRequestException('Quita disponibilidad desde la selección de docentes');
  if (value === 'desasignaciones')
    throw new BadRequestException(
      'Desasigna desde la supervisión de asignación docente',
    );
  if (!IMPORT_KINDS.includes(value as ImportKind))
    throw new BadRequestException('Tipo de importación desconocido');
  return value as ImportKind;
}

export function cellText(cell: ExcelJS.Cell, timeColumn = false): string {
  const value = cell.value;
  if (value === null || value === undefined) return '';
  if (
    typeof value === 'object' &&
    ('formula' in value || 'sharedFormula' in value)
  )
    throw new BadRequestException(
      `Celda ${cell.address}: reemplaza las fórmulas por valores`,
    );
  if (value instanceof Date) return value.toISOString().slice(11, 16);
  if (timeColumn && typeof value === 'number' && value >= 0 && value <= 1) {
    const minutes = Math.round(value * 1440);
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }
  return cell.text.trim();
}

let activeReads = 0;
export async function readImport(
  buffer: Buffer,
  filename: string,
  kind: ImportKind,
): Promise<RawRow[]> {
  if (activeReads >= 2)
    throw new HttpException(
      'Hay otras importaciones en lectura; intenta nuevamente',
      429,
    );
  activeReads++;
  try {
    return await readData(buffer, filename, kind);
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException(
      'No se pudo leer el archivo; revisa su formato y vuelve a guardarlo sin fórmulas',
    );
  } finally {
    activeReads--;
  }
}

async function readData(
  buffer: Buffer,
  filename: string,
  kind: ImportKind,
): Promise<RawRow[]> {
  if (!buffer?.length || buffer.length > 8 * 1024 * 1024)
    throw new BadRequestException('El archivo debe tener entre 1 byte y 8 MB');
  let rows: RawRow[] = [];
  if (filename.toLowerCase().endsWith('.json')) {
    const data: unknown = JSON.parse(buffer.toString('utf8'));
    if (!Array.isArray(data))
      throw new BadRequestException('El JSON debe ser una lista de registros');
    rows = data.map((value: unknown, index) => {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new BadRequestException(`Registro ${index + 1} inválido`);
      return {
        line: index + 1,
        values: Object.fromEntries(
          Object.entries(value).map(([key, entry]) => [
            field(key),
            String(entry ?? '').trim(),
          ]),
        ),
      };
    });
  } else {
    const workbook = new ExcelJS.Workbook();
    if (filename.toLowerCase().endsWith('.xlsx')) {
      await checkArchiveBudget(buffer);
      await workbook.xlsx.load(
        buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
      );
    } else if (filename.toLowerCase().endsWith('.csv')) {
      const firstLine = buffer.toString('utf8').split(/\r?\n/)[0];
      await workbook.csv.read(Readable.from(buffer), {
        parserOptions: { delimiter: firstLine.includes(';') ? ';' : ',' },
        map: (value: string) => value,
      });
    } else throw new BadRequestException('Usa un archivo .xlsx, .csv o .json');
    const sheet = workbook.getWorksheet('Datos') ?? workbook.worksheets[0];
    if (!sheet || sheet.rowCount > 10001)
      throw new BadRequestException('Máximo 10000 filas por archivo');
    const columns: string[] = [];
    sheet.getRow(1).eachCell((cell, col) => {
      columns[col] = field(cellText(cell).replace(/^\uFEFF/, ''));
    });
    const names = columns.filter(Boolean);
    if (names.length !== new Set(names).size)
      throw new BadRequestException('Hay encabezados repetidos');
    const missing = headers[kind].filter(
      (name) =>
        !['celulares_adicionales', 'alcance'].includes(name) &&
        !(name === 'turno' && kind.includes('disponibilidad')) &&
        !names.includes(name),
    );
    if (missing.length)
      throw new BadRequestException(`Faltan columnas: ${missing.join(', ')}`);
    sheet.eachRow((row, number) => {
      if (number === 1) return;
      const values = Object.fromEntries(
        columns.flatMap((name, col) =>
          name
            ? [
                [
                  name,
                  cellText(
                    row.getCell(col),
                    name === 'hora_inicio' || name === 'hora_fin',
                  ),
                ],
              ]
            : [],
        ),
      );
      if (Object.values(values).some(Boolean))
        rows.push({ line: number, values });
    });
  }
  if (!rows.length || rows.length > 10000)
    throw new BadRequestException('Se requieren entre 1 y 10000 filas');
  return rows;
}
