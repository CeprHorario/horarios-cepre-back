import type { SessionTx } from '../class-session-records/session.types';

interface Recipient {
  id: string;
  origin: string;
}

/** NOTIFY has an 8000-byte limit. Durable notifications remain the source of truth. */
export async function signalNotificationRecipients(
  tx: SessionTx,
  schema: string,
  recipients: Recipient[],
) {
  const payloads: string[] = [];
  let batch: Recipient[] = [];
  for (const recipient of new Map(
    recipients.map((r) => [r.origin + ':' + r.id, r]),
  ).values()) {
    const next = [...batch, recipient];
    if (
      batch.length &&
      Buffer.byteLength(JSON.stringify({ schema, recipients: next }), 'utf8') >
        6000
    ) {
      payloads.push(JSON.stringify({ schema, recipients: batch }));
      batch = [];
    }
    batch.push(recipient);
  }
  if (batch.length)
    payloads.push(JSON.stringify({ schema, recipients: batch }));
  if (payloads.length)
    await tx.$executeRaw`SELECT pg_notify('operations_changed', value) FROM jsonb_array_elements_text(${JSON.stringify(payloads)}::jsonb)`;
}
