import { SessionTx } from '../class-session-records/session.types';

/** Aplica excepciones de una fecha por conjuntos, con auditoría y sin alterar horarios semanales. */
export async function applyApprovedReplacements(tx: SessionTx) {
  const [previous] = await tx.$queryRaw<
    { value: string | null }[]
  >`SELECT current_setting('cepr.session_override',true) AS value`;
  await tx.$queryRaw`SELECT set_config('cepr.session_override','true',true)`;
  await tx.$executeRaw`WITH mismatches AS (
    INSERT INTO replacement_application_issues(request_id,class_id,hour_session_id,reason)
    SELECT r.id,(b->>'classId')::uuid,(b->>'hourSessionId')::int,'Cambió el horario aprobado; revisar antes de aplicar el reemplazo'
    FROM replacement_requests r CROSS JOIN jsonb_array_elements(r.blocks) b
    LEFT JOIN class_session_records rec ON rec.date=r.date AND rec.class_id=(b->>'classId')::uuid AND rec.hour_session_id=(b->>'hourSessionId')::int
    WHERE r.status='APPROVED' AND r.subject_role IN ('profesor','monitor') AND
      EXISTS(SELECT 1 FROM class_session_records day WHERE day.date=r.date AND day.class_id=(b->>'classId')::uuid)
      AND (rec.id IS NULL OR rec.scheduled_start<>(b->>'start')::timestamptz OR rec.scheduled_end<>(b->>'end')::timestamptz)
    ON CONFLICT DO NOTHING RETURNING request_id
  ) INSERT INTO public.operation_notifications(recipient_id,recipient_origin,process_schema,kind,title,message,request_id,dedupe_key)
    SELECT u.id,'core_schema',current_schema(),'REPLACEMENT_SCHEDULE','Reemplazo requiere revisión','La programación ya no coincide con el permiso aprobado.',m.request_id,'replacement-schedule:'||current_schema()||':'||m.request_id||':'||u.id
    FROM (SELECT DISTINCT request_id FROM mismatches) m CROSS JOIN core_schema.users u WHERE u.role='administrador' AND u.is_active ON CONFLICT DO NOTHING`;
  await tx.$executeRaw`WITH sources AS MATERIALIZED (
    SELECT r.*,rec.id AS record_id,to_jsonb(rec) AS before,t.id AS teacher_id,m.id AS monitor_id,u.email,COALESCE(NULLIF(BTRIM(concat_ws(' ',p.first_name,p.last_name)),''),u.email) AS person_name
    FROM replacement_requests r CROSS JOIN jsonb_array_elements(r.blocks) b
    JOIN class_session_records rec ON rec.date=r.date AND rec.class_id=(b->>'classId')::uuid AND rec.hour_session_id=(b->>'hourSessionId')::int
    JOIN users u ON u.id=r.replacement_user_id LEFT JOIN user_profiles p ON p.user_id=u.id
    LEFT JOIN teachers t ON t.user_id=u.id AND r.subject_role='profesor' LEFT JOIN monitors m ON m.user_id=u.id AND r.subject_role='monitor'
    WHERE r.status='APPROVED' AND r.subject_role IN ('profesor','monitor') AND rec.deleted_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM replacement_application_issues issue WHERE issue.request_id=r.id)
      AND rec.scheduled_start=(b->>'start')::timestamptz AND rec.scheduled_end=(b->>'end')::timestamptz
      AND NOT EXISTS(SELECT 1 FROM session_coverages c WHERE c.record_id=rec.id AND c.kind=CASE WHEN r.subject_role='profesor' THEN 'TEACHER' ELSE 'MONITOR' END AND c.status IN ('PENDING','AUTHORIZED'))
  ), inserted AS (
    INSERT INTO session_coverages(record_id,kind,teacher_id,monitor_id,mode,status,person_snapshot,operation_id,requested_by,resolved_by,resolved_at,reason)
    SELECT record_id,CASE WHEN subject_role='profesor' THEN 'TEACHER' ELSE 'MONITOR' END,teacher_id,monitor_id,CASE WHEN kind='EMERGENCY' THEN 'EMERGENCY' ELSE 'PLANNED' END,'AUTHORIZED',jsonb_build_object('id',COALESCE(teacher_id,monitor_id),'email',email,'name',person_name),id,decided_by,decided_by,decided_at,reason FROM sources ON CONFLICT DO NOTHING RETURNING record_id,operation_id
  ), changed AS (
    UPDATE class_session_records rec SET class_state=CASE WHEN s.subject_role='profesor' THEN CASE WHEN s.kind='EMERGENCY' THEN 'RE' ELSE 'RN' END ELSE rec.class_state END,
      effective_teacher_id=CASE WHEN s.subject_role='profesor' THEN s.teacher_id ELSE rec.effective_teacher_id END,
      effective_monitor_id=CASE WHEN s.subject_role='monitor' THEN s.monitor_id ELSE rec.effective_monitor_id END,
      effective_snapshot=COALESCE(rec.effective_snapshot,'{}'::jsonb)||jsonb_build_object(CASE WHEN s.subject_role='profesor' THEN 'TEACHER' ELSE 'MONITOR' END,jsonb_build_object('id',COALESCE(s.teacher_id,s.monitor_id),'email',s.email,'name',s.person_name)),
      actual_start=CASE WHEN s.subject_role='profesor' AND s.kind='EMERGENCY' THEN rec.scheduled_start ELSE rec.actual_start END,
      actual_end=CASE WHEN s.subject_role='profesor' AND s.kind='EMERGENCY' THEN rec.scheduled_end ELSE rec.actual_end END,
      teaching_status=CASE WHEN s.subject_role='profesor' AND s.kind='EMERGENCY' THEN 'TAUGHT' ELSE rec.teaching_status END,
      version=rec.version+1,updated_at=clock_timestamp()
    FROM sources s JOIN inserted i ON i.record_id=s.record_id AND i.operation_id=s.id WHERE rec.id=s.record_id RETURNING rec.*
  ), remembered AS (INSERT INTO replacement_application_snapshots(request_id,record_id,before_value,applied_version) SELECT s.id,c.id,s.before,c.version FROM changed c JOIN sources s ON s.record_id=c.id ON CONFLICT DO NOTHING RETURNING record_id) INSERT INTO session_audit_events(record_id,action,actor,before,after,reason)
    SELECT c.id,'REPLACEMENT_APPLIED',s.decided_by,s.before,to_jsonb(c),s.reason FROM changed c JOIN sources s ON s.record_id=c.id`;
  await tx.$queryRaw`SELECT set_config('cepr.session_override',${previous?.value ?? ''},true)`;
}
