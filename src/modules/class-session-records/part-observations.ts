import { createHash } from 'node:crypto';
import { SessionActor, SessionTx } from './session.types';
import { ClassSessionRecord } from '../../generated/prisma/client';

/** Un antecedente por docente y parte; sus correcciones son eventos, no nuevas incidencias. */
export async function syncPartObservations(
  tx: SessionTx,
  actor: SessionActor,
  record: ClassSessionRecord,
  observations: string | null | undefined,
  now: Date,
) {
  if (
    observations === undefined ||
    (observations ?? '').trim() ===
      (Array.isArray(record.structuredObservations)
        ? record.structuredObservations
            .filter(
              (o): o is { target: string; description: string } =>
                !!o &&
                typeof o === 'object' &&
                !Array.isArray(o) &&
                o.target === 'TEACHER' &&
                typeof o.description === 'string',
            )
            .map((o) => o.description.trim())
            .join('\n')
        : '')
  )
    return;
  const text = (observations ?? '').trim();
  const coverage = await tx.sessionCoverage.findFirst({
    where: { recordId: record.id, kind: 'TEACHER', status: 'AUTHORIZED' },
    orderBy: { id: 'desc' },
  });
  const teacherId =
    record.effectiveTeacherId ?? coverage?.teacherId ?? record.titularTeacherId;
  if (!teacherId)
    return text
      ? 'Observaciones guardadas. No se vinculó un antecedente personal porque el bloque no tiene docente asignado.'
      : undefined;
  const teacher = await tx.teacher.findUnique({
    where: { id: teacherId },
    include: { user: { include: { userProfile: true } } },
  });
  const profile = teacher?.user.userProfile;
  if (!teacher || !profile?.dni || !/^\d{8}$/.test(profile.dni))
    return text
      ? 'Observaciones guardadas. Administración debe completar el DNI del docente para vincular su antecedente.'
      : undefined;
  const h = createHash('sha256')
    .update(`PART_OBSERVATIONS|${actor.schema}|${record.id}|${profile.dni}`)
    .digest('hex');
  const id = `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
  const author = JSON.stringify({ ...actor, source: 'PART_OBSERVATIONS' });
  const name =
    [profile.firstName, profile.lastName].filter(Boolean).join(' ') ||
    teacher.user.email;
  let created = 0;
  if (text)
    created =
      await tx.$executeRaw`INSERT INTO public.person_incidences(id,subject_dni,subject_role,subject_account_id,subject_name,process_schema,record_id,class_id,title,description,occurred_at,actor,actor_id,actor_origin)
    VALUES(${id}::uuid,${profile.dni},'profesor',${teacher.userId}::uuid,${name},${actor.schema},${record.id},${record.classId}::uuid,${`Observaciones del parte #${record.id}`},${text},${now},${author}::jsonb,${actor.id}::uuid,${actor.origin}) ON CONFLICT(id) DO NOTHING`;
  const rows = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM public.person_incidences WHERE id=${id}::uuid FOR UPDATE`;
  if (rows.length)
    await tx.$executeRaw`INSERT INTO public.person_incidence_events(incidence_id,action,actor,reason)
    VALUES(${id}::uuid,${created ? 'CREATED' : text ? 'OBSERVATIONS_UPDATED' : 'OBSERVATIONS_CLEARED'},${author}::jsonb,${text || 'Observaciones retiradas del parte; se conserva el antecedente original para revisión administrativa.'})`;
}
