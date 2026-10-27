import { headers, type ImportKind } from './workbook';

export interface ImportColumn {
  key: string;
  label: string;
  required: boolean;
  headerRequired: boolean;
  format: string;
  example: string;
  description: string;
}

export const columnLabels: Record<string, string> = {
  correo: 'Correo',
  dni: 'DNI',
  nombres: 'Nombres',
  apellidos: 'Apellidos',
  correo_personal: 'Correo Personal',
  celular: 'Celular',
  celulares_adicionales: 'Celulares Adicionales',
  salon: 'Salón',
  turno: 'Turno',
  curso: 'Curso',
  dedicacion: 'Dedicación',
  horas_maximas: 'Horas Máximas',
  dia: 'Día',
  hora_inicio: 'Hora Inicio',
  hora_fin: 'Hora Fin',
  alcance: 'Alcance',
};

const definitions: Record<
  string,
  Pick<ImportColumn, 'format' | 'example' | 'description'>
> = {
  alcance: {
    format: 'Rango / Turno completo / Todo el día',
    example: 'Todo el día',
    description:
      'Rango usa horas; Turno completo usa el turno indicado; Todo el día cubre los horarios de todos los turnos del proceso en ese día.',
  },
  correo: {
    format: 'Correo electrónico, máximo 48 caracteres',
    example: 'persona@example.com',
    description: 'Correo de acceso a Google de la persona correspondiente.',
  },
  dni: {
    format: 'Texto de 8 dígitos',
    example: '01234567',
    description:
      'Conserva el cero inicial. No uses separadores ni una celda numérica.',
  },
  nombres: {
    format: 'Texto, máximo 128 caracteres',
    example: 'Ana María',
    description: 'Nombres de la persona.',
  },
  apellidos: {
    format: 'Texto, máximo 128 caracteres',
    example: 'Pérez López',
    description: 'Apellidos de la persona.',
  },
  correo_personal: {
    format: 'Correo electrónico, máximo 48 caracteres',
    example: 'contacto@example.com',
    description: 'Correo de contacto adicional; puede quedar vacío.',
  },
  celular: {
    format: 'Texto de 9 dígitos, comienza con 9',
    example: '987654321',
    description: 'Celular principal; puede quedar vacío.',
  },
  celulares_adicionales: {
    format: 'Celulares de 9 dígitos separados por comas',
    example: '987654321,912345678',
    description: 'Puede quedar vacío. Esta cabecera también puede omitirse.',
  },
  salon: {
    format: 'Código o nombre de la hoja Salones',
    example: 'B-101',
    description:
      'Usa el nombre del catálogo o su código corto, junto con el turno.',
  },
  turno: {
    format: 'Nombre de turno del catálogo',
    example: 'Turno 01',
    description:
      'Debe corresponder al salón. Un supervisor solo puede repetirse en su mismo turno.',
  },
  curso: {
    format: 'Nombre de la hoja Cursos',
    example: 'Física',
    description: 'Curso del docente; debe existir en el proceso seleccionado.',
  },
  dedicacion: {
    format: 'Tiempo completo / Medio tiempo / Tiempo libre',
    example: 'Medio tiempo',
    description: 'Selecciona una de las tres opciones.',
  },
  horas_maximas: {
    format: 'Número entero entre 1 y 100',
    example: '20',
    description:
      'Máximo de bloques pedagógicos asignables al docente, no minutos.',
  },
  dia: {
    format: 'Lunes, Martes, Miércoles, Jueves, Viernes, Sábado o Domingo',
    example: 'Lunes',
    description: 'Día semanal de la disponibilidad; se admite con o sin tilde.',
  },
  hora_inicio: {
    format: 'Texto HH:mm, de 00:00 a 23:59',
    example: '07:00',
    description:
      'Hora de inicio del rango, con dos dígitos para la hora y el minuto.',
  },
  hora_fin: {
    format: 'Texto HH:mm, de 00:00 a 24:00',
    example: '07:40',
    description:
      'Debe ser posterior al inicio. Solo se asignan bloques completamente cubiertos.',
  },
};

export function importColumns(kind: ImportKind): ImportColumn[] {
  const availability = kind.includes('disponibilidad');
  return headers[kind].map((key) => ({
    key,
    label: columnLabels[key] ?? key,
    required: !['correo_personal', 'celular', 'celulares_adicionales'].includes(
      key,
    ),
    headerRequired:
      !['celulares_adicionales', 'alcance'].includes(key) &&
      !(availability && key === 'turno'),
    ...definitions[key],
    ...(availability &&
    ['turno', 'hora_inicio', 'hora_fin', 'alcance'].includes(key)
      ? {
          required: false,
          description:
            key === 'turno'
              ? 'Obligatorio para Turno completo; usa el nombre exacto de Horarios.'
              : key.startsWith('hora_')
                ? 'Obligatorio para Rango. Dejar vacío para Turno completo o Todo el día. Un rango de 08:00 a 08:40 solo cubre esos 40 minutos.'
                : definitions[key].description,
        }
      : {}),
    ...(key === 'correo'
      ? {
          description:
            kind === 'supervisores'
              ? 'Correo propio del supervisor: lo identifica para registrarlo o actualizarlo. Repite este correo y los mismos datos para varios salones de su turno.'
              : kind === 'monitores'
                ? 'Correo de acceso que tendrá el monitor del salón. Se conserva su cuenta existente y su vínculo al salón.'
                : 'Correo del docente. En disponibilidad y desasignación debe corresponder a un docente activo ya registrado.',
        }
      : {}),
  }));
}
