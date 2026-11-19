import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { SessionTx } from '../class-session-records/session.types';
import type { OperationsContext } from './operations-context.service';
import type { RequestContextDto } from './operations.dto';
import type { WorkBlock } from './operations.service';

export async function coverageWork(tx:SessionTx,ctx:Awaited<ReturnType<OperationsContext['get']>>,q:RequestContextDto,hours?:number[]) {
  const rows=await tx.$queryRaw<{id:number;classId:string;shiftId:number;supervisorId:string|null;courseId:number;date:Date;period:number;hourSessionId:number;start:Date;end:Date;kind:string;mode:string;subjectUserId:string|null;replacementUserId:string;name:string;course:string;areaId:number}[]>`
    SELECT rec.id,rec.class_id AS "classId",rec.shift_id AS "shiftId",rec.supervisor_id AS "supervisorId",rec.course_id AS "courseId",rec.date,rec.period,rec.hour_session_id AS "hourSessionId",rec.scheduled_start AS start,rec.scheduled_end AS end,
      cv.kind,cv.mode,CASE WHEN cv.kind='TEACHER' THEN titular_t.user_id ELSE titular_m.user_id END AS "subjectUserId",
      COALESCE(candidate_t.user_id,candidate_m.user_id) AS "replacementUserId",cl.name,co.name AS course,cl.area_id AS "areaId"
    FROM session_coverages cv JOIN class_session_records rec ON rec.id=cv.record_id JOIN classes cl ON cl.id=rec.class_id JOIN courses co ON co.id=rec.course_id
    LEFT JOIN teachers titular_t ON titular_t.id=rec.titular_teacher_id LEFT JOIN monitors titular_m ON titular_m.id=rec.titular_monitor_id
    LEFT JOIN teachers candidate_t ON candidate_t.id=cv.teacher_id LEFT JOIN monitors candidate_m ON candidate_m.id=cv.monitor_id
    WHERE cv.operation_id=${q.coverageOperationId}::uuid AND cv.status IN ('PENDING','AUTHORIZED') ORDER BY rec.scheduled_start`;
  if(!rows.length)throw new NotFoundException('Cobertura pendiente de documento no encontrada');
  if(rows.some(r=>r.subjectUserId!==ctx.user.id))throw new ForbiddenException('Solo el titular de esta cobertura puede presentar su documento');
  if(rows.some(r=>r.date.toISOString().slice(0,10)!==q.date||r.classId!==rows[0].classId)||q.classId&&q.classId!==rows[0].classId)throw new BadRequestException('La fecha y salón deben corresponder a la cobertura');
  const selected=hours?rows.filter(r=>hours.includes(r.hourSessionId)):rows;
  if(hours&&hours.length!==rows.length)throw new BadRequestException('El documento debe respaldar todos los bloques de esa cobertura registrada');
  if(!selected.length||hours&&selected.length!==hours.length)throw new BadRequestException('Los bloques no corresponden al reemplazo registrado');
  const minutes=(d:Date)=>{const v=new Date(+d-5*3600000);return v.getUTCHours()*60+v.getUTCMinutes();};
  const blocks:WorkBlock[]=selected.map(r=>({hourSessionId:r.hourSessionId,period:r.period,classId:r.classId,className:r.name,courseId:r.courseId,course:r.course,shiftId:r.shiftId,start:r.start.toISOString(),end:r.end.toISOString(),startMinute:minutes(r.start),endMinute:minutes(r.end)}));
  const total=await tx.classSessionRecord.count({where:{date:rows[0].date,classId:rows[0].classId,shiftId:rows[0].shiftId,deletedAt:null,...(rows[0].kind==='TEACHER'?{courseId:rows[0].courseId}:{})}});
  return {subjectRole:rows[0].kind==='TEACHER'?'profesor' as const:'monitor' as const,subjectUserId:ctx.user.id,classId:rows[0].classId,courseId:rows[0].courseId,shiftId:rows[0].shiftId,supervisorId:rows[0].supervisorId,areaId:rows[0].areaId,blocks,coverageOperationId:q.coverageOperationId,recordIds:selected.map(r=>r.id),replacementUserId:rows[0].replacementUserId,fullCoverage:rows.length===total};
}
