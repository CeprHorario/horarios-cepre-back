import { ConflictException, ForbiddenException } from '@nestjs/common';

export interface WorkflowRequest {
  status: string; requester_user_id: string; replacement_user_id: string;
  cancellation_stage: string|null;
}
export function replacementDecision(r: WorkflowRequest, action: string, actor: {id:string;admin:boolean;reviewer:boolean}, hasReviewer:boolean) {
  const owner=actor.id===r.requester_user_id;
  const next={status:r.status,cancellationStage:r.cancellation_stage,event:action,apply:false,revoke:false};
  const review=()=>{
    if(actor.id===r.replacement_user_id||owner)throw new ForbiddenException('No puedes revisar tu propia solicitud ni un reemplazo a tu favor');
    if(r.cancellation_stage==='ADMIN'||(!r.cancellation_stage&&(r.status==='ADMIN_PENDING'||!hasReviewer))) {
      if(!actor.admin)throw new ForbiddenException('El permiso final corresponde al administrador');
    } else if(!actor.reviewer)throw new ForbiddenException('La revisión corresponde al supervisor o coordinador asignado');
  };
  if(action==='REQUEST_CANCEL'||(action==='CANCELLED'&&!actor.admin)) {
    if(!owner&&!actor.reviewer)throw new ForbiddenException('Solo el solicitante o su revisor puede solicitar la cancelación');
    if(!['PENDING','ADMIN_PENDING','CHANGES','APPROVED'].includes(r.status)|| (r.cancellation_stage&&r.cancellation_stage!=='CHANGES'))throw new ConflictException('Ya existe una cancelación en trámite o la solicitud está cerrada');
    next.cancellationStage=actor.reviewer||!hasReviewer?'ADMIN':'REVIEW';next.event='CANCELLATION_REQUESTED';return next;
  }
  if(r.cancellation_stage) {
    if(r.cancellation_stage==='CHANGES')throw new ConflictException('El solicitante debe corregir el motivo de cancelación');
    review();
    if(action==='APPROVED'||action==='APPROVE_CANCEL'||action==='CANCELLED') {
      if(r.cancellation_stage==='REVIEW'){next.cancellationStage='ADMIN';next.event='CANCELLATION_REVIEWED';}
      else {next.status='CANCELLED';next.cancellationStage=null;next.event='CANCELLED';next.revoke=r.status==='APPROVED';}
    } else if(action==='CHANGES'){next.cancellationStage='CHANGES';next.event='CANCELLATION_CHANGES';}
    else if(action==='REJECTED'||action==='REJECT_CANCEL'){next.cancellationStage=null;next.event='CANCELLATION_REJECTED';}
    else throw new ConflictException('Acción de cancelación inválida');
    return next;
  }
  if(!['PENDING','ADMIN_PENDING'].includes(r.status))throw new ConflictException('La solicitud ya fue resuelta o requiere corrección');
  review();
  if(action==='APPROVED'){
    if(r.status==='PENDING'&&hasReviewer){next.status='ADMIN_PENDING';next.event='REVIEW_APPROVED';}
    else {next.status='APPROVED';next.apply=true;}
  } else if(action==='CHANGES'||action==='REJECTED')next.status=action;
  else throw new ConflictException('Solicita primero la cancelación por su circuito de aprobación');
  return next;
}
