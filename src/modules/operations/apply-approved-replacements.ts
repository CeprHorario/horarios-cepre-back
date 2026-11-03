import { SessionTx } from '../class-session-records/session.types';

/** Aplica excepciones de una fecha por conjuntos, con auditoría y sin alterar horarios semanales. */
export async function applyApprovedReplacements(tx: SessionTx) {
  const [previous] = await tx.$queryRaw<
    { value: string | null }[]
  >`SELECT current_setting('cepr.session_override',true) AS value`;
  await tx.$queryRaw`SELECT set_config('cepr.session_override','true',true)`;
  await tx.$executeRaw`WITH sources AS MATERIALIZED (
    SELECT r.*,rec.id AS record_id,to_jsonb(rec) AS before,t.id AS teacher_id,m.id AS monitor_id,u.email,COALESCE(NULLIF(BTRIM(concat_ws(' ',p.first_name,p.last_name)),''),u.email) AS person_name
    FROM replacement_requests r CROSS JOIN jsonb_array_elements(r.blocks) b
    JOIN class_session_records rec ON rec.date=r.date AND rec.class_id=(b->>'classId')::uuid AND rec.hour_session_id=(b->>'hourSessionId')::int
    JOIN users u ON u.id=r.replacement_user_id LEFT JOIN user_profiles p ON p.user_id=u.id
    LEFT JOIN teachers t ON t.user_id=u.id AND r.subject_role='profesor' LEFT JOIN monitors m ON m.user_id=u.id AND r.subject_role='monitor'
    WHERE r.status='APPROVED' AND r.subject_role IN ('profesor','monitor') AND rec.deleted_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM session_coverages c WHERE c.record_id=rec.id AND c.kind=CASE WHEN r.subject_role='profesor' THEN 'TEACHER' ELSE 'MONITOR' END AND c.status IN ('PENDING','AUTHORIZED'))
  ), inserted AS (
    INSERT INTO session_coverages(record_id,kind,teacher_id,monitor_id,mode,status,person_snapshot,operation_id,requested_by,resolved_by,resolved_at,reason)
    SELECT record_id,CASE WHEN subject_role='profesor' THEN 'TEACHER' ELSE 'MONITOR' END,teacher_id,monitor_id,CASE WHEN kind='EMERGENCY' THEN 'EMERGENCY' ELSE 'PLANNED' END,'AUTHORIZED',jsonb_build_object('id',COALESCE(teacher_id,monitor_id),'email',email,'name',person_name),id,decided_by,decided_by,decided_at,reason FROM sources ON CONFLICT DO NOTHING RETURNING record_id,operation_id
  ), changed AS (
    UPDATE class_session_records rec SET class_state=CASE WHEN s.subject_role='profesor' THEN CASE WHEN s.kind='EMERGENCY' THEN 'RE' ELSE 'RN' END ELSE rec.class_state END,
      monitor_account_id=CASE WHEN s.subject_role='monitor' THEN s.replacement_user_id ELSE rec.monitor_account_id END,version=rec.version+1,updated_at=clock_timestamp()
    FROM sources s JOIN inserted i ON i.record_id=s.record_id AND i.operation_id=s.id WHERE rec.id=s.record_id RETURNING rec.*
  ) INSERT INTO session_audit_events(record_id,action,actor,before,after,reason)
    SELECT c.id,'REPLACEMENT_APPLIED',s.decided_by,s.before,to_jsonb(c),s.reason FROM changed c JOIN sources s ON s.record_id=c.id`;
  await tx.$executeRaw`WITH before AS MATERIALIZED (
    SELECT rec.id,to_jsonb(rec) AS old,r.decided_by,r.reason,replacement.id AS replacement_id
    FROM replacement_requests r JOIN supervisors original ON original.user_id=r.subject_user_id JOIN supervisors replacement ON replacement.user_id=r.replacement_user_id
    JOIN class_session_records rec ON rec.date=r.date AND rec.supervisor_id=original.id
    WHERE r.status='APPROVED' AND r.subject_role='supervisor' AND rec.deleted_at IS NULL
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(r.blocks) b WHERE (b->>'hourSessionId')::int=rec.hour_session_id)
  ), changed AS (
    UPDATE class_session_records rec SET supervisor_id=b.replacement_id,version=rec.version+1,updated_at=clock_timestamp() FROM before b WHERE rec.id=b.id RETURNING rec.*
  ) INSERT INTO session_audit_events(record_id,action,actor,before,after,reason)
    SELECT c.id,'SUPERVISOR_REPLACEMENT_APPLIED',b.decided_by,b.old,to_jsonb(c),b.reason FROM changed c JOIN before b ON b.id=c.id`;
  await tx.$queryRaw`SELECT set_config('cepr.session_override',${previous?.value ?? ''},true)`;
}
