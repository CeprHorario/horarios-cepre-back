import { generateHourSessions, validateShiftTimes } from './utils';

describe('Duración configurable de clases y descansos', () => {
  it('genera tres clases de 50 min y dos descansos de 10 min, sin descanso final', () => {
    const shift = validateShiftTimes(
      { name: 'Turno 01', startTime: '07:00', endTime: '09:50' },
      50,
      10,
    );
    const sessions = generateHourSessions(shift, 50, 10);
    expect(
      sessions.map((s) => [
        s.startTime.slice(0, 5),
        s.endTime.slice(0, 5),
        s.durationMinutes,
      ]),
    ).toEqual([
      ['07:00', '07:50', 50],
      ['08:00', '08:50', 50],
      ['09:00', '09:50', 50],
    ]);
  });

  it('admite descanso cero y conserva los valores históricos por defecto', () => {
    const shift = validateShiftTimes(
      { name: 'Turno 01', startTime: '07:00', endTime: '09:00' },
      60,
      0,
    );
    expect(generateHourSessions(shift, 60, 0)).toHaveLength(2);
    const historical = validateShiftTimes({
      name: 'Turno 01',
      startTime: '07:00',
      endTime: '12:10',
    });
    expect(generateHourSessions(historical)).toHaveLength(7);
  });

  it('rechaza rangos que dejan una sesión incompleta y duración cero', () => {
    expect(() =>
      validateShiftTimes(
        { name: 'Turno 01', startTime: '07:00', endTime: '09:40' },
        50,
        10,
      ),
    ).toThrow();
    expect(() =>
      generateHourSessions(
        { id: 1, name: 'Turno 01', startTime: '07:00:00', endTime: '08:00:00' },
        0,
        5,
      ),
    ).toThrow();
  });
});
