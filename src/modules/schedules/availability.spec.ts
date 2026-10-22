import { covers, normalizeIntervals, overlaps } from './availability';

const interval = (
  startMinute: number,
  endMinute: number,
  weekday = 'Lunes',
) => ({ weekday, startMinute, endMinute });

describe('Disponibilidad independiente del turno', () => {
  it('comparte horas idénticas y exige cobertura completa de un bloque solapado', () => {
    const available = [interval(420, 460)];
    expect(covers(available, interval(420, 460))).toBe(true);
    expect(covers(available, interval(440, 480))).toBe(false);
    expect(covers(available, interval(420, 460, 'Martes'))).toBe(false);
  });

  it('une intervalos contiguos sin cubrir descansos o huecos', () => {
    expect(
      covers([interval(420, 440), interval(440, 460)], interval(420, 460)),
    ).toBe(true);
    expect(
      covers([interval(420, 460), interval(465, 505)], interval(440, 480)),
    ).toBe(false);
    expect(
      normalizeIntervals([
        interval(440, 480),
        interval(420, 460),
        interval(480, 500),
      ]),
    ).toEqual([interval(420, 500)]);
  });

  it('detecta cruces parciales entre turnos, sin rechazar bloques consecutivos', () => {
    expect(overlaps(interval(420, 460), interval(440, 480))).toBe(true);
    expect(overlaps(interval(420, 460), interval(460, 500))).toBe(false);
    expect(overlaps(interval(420, 460), interval(420, 460, 'Martes'))).toBe(
      false,
    );
  });
});
