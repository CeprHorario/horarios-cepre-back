import { ImportsService } from './imports.service';
import { RequestContext } from '@database/schema-manager/request-context';
import { DrizzleService } from '@database/drizzle/drizzle.service';

describe('Disponibilidad por horarios del proceso', () => {
  const catalog = {
    users: [],
    teachers: [{ id: 't', user_id: 'u', email: 't@example.com' }],
    classes: [],
    courses: [],
    sessions: [
      { turno: 'Turno 01', start: '08:15', end: '09:05' },
      { turno: 'Turno 01', start: '09:15', end: '10:05' },
      { turno: 'Turno 02', start: '16:00', end: '16:50' },
    ],
  };
  const service = new ImportsService(
    {} as DrizzleService,
    new RequestContext(),
  );
  const resolve = (values: Record<string, string>) =>
    service['resolve'](
      'disponibilidad',
      [
        {
          line: 2,
          values: { correo: 't@example.com', dia: 'Lunes', ...values },
        },
      ],
      catalog,
    )[0];

  it('devuelve errores por fila para horas inválidas e intervalos invertidos', () => {
    expect(
      resolve({ hora_inicio: '25:00', hora_fin: '26:00' }).errors,
    ).toContain('Horas inválidas; usa HH:mm');
    expect(
      resolve({ hora_inicio: '10:00', hora_fin: '08:00' }).errors,
    ).toContain('La hora de fin debe ser posterior a la inicial');
  });

  it('usa los límites de todos los turnos para Todo el día', () => {
    expect(resolve({ alcance: 'Todo el día' })).toMatchObject({
      start_minute: 495,
      end_minute: 1010,
      errors: [],
    });
  });
  it('usa exclusivamente el turno elegido, con duraciones dinámicas', () => {
    expect(
      resolve({ alcance: 'Turno completo', turno: 'Turno 01' }),
    ).toMatchObject({ start_minute: 495, end_minute: 605, errors: [] });
  });
  it('rechaza turnos inexistentes, datos ambiguos y rangos parciales', () => {
    expect(
      resolve({ alcance: 'Turno completo', turno: 'Turno 99' }).errors,
    ).not.toHaveLength(0);
    expect(
      resolve({ alcance: 'Todo el día', hora_inicio: '08:00' }).errors,
    ).not.toHaveLength(0);
    expect(
      resolve({ hora_inicio: '08:15', hora_fin: '08:55' }).errors,
    ).not.toHaveLength(0);
    expect(resolve({ hora_inicio: '08:15', hora_fin: '09:05' })).toMatchObject({
      start_minute: 495,
      end_minute: 545,
      errors: [],
    });
  });
});
