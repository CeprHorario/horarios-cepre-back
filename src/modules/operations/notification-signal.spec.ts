import { signalNotificationRecipients } from './notification-signal';
import type { SessionTx } from '../class-session-records/session.types';

describe('Señales de notificaciones', () => {
  it('divide destinatarios sin perderlos ni superar el límite de PostgreSQL', async () => {
    const execute = jest.fn().mockResolvedValue(0);
    const recipients = Array.from({ length: 240 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      origin: 'proceso_con_nombre_largo_y_caracteres_áéí',
    }));
    await signalNotificationRecipients(
      { $executeRaw: execute } as unknown as SessionTx,
      'proceso_a',
      [...recipients, recipients[0]],
    );
    expect(execute).toHaveBeenCalledTimes(1);
    const payloads = JSON.parse(execute.mock.calls[0][1]) as string[];
    expect(payloads.length).toBeGreaterThan(1);
    expect(payloads.every((p) => Buffer.byteLength(p, 'utf8') <= 6000)).toBe(
      true,
    );
    expect(payloads.flatMap((p) => JSON.parse(p).recipients)).toEqual(
      recipients,
    );
  });

  it('no consulta PostgreSQL si no hay destinatarios', async () => {
    const execute = jest.fn();
    await signalNotificationRecipients(
      { $executeRaw: execute } as unknown as SessionTx,
      'proceso_a',
      [],
    );
    expect(execute).not.toHaveBeenCalled();
  });
});
