import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { ClassSessionRecord, Prisma } from '../../generated/prisma/client';
import type { SessionActor } from './session.types';

export function enforceBlockTimes(record:ClassSessionRecord,start:Date|null,end:Date|null) {
  const policy=record.timingPolicy as Prisma.JsonObject;
  const last=+record.scheduledEnd+Number(policy.breakMinutes??5)*60000;
  for(const time of [start,end])if(time&&(+time<+record.scheduledStart||+time>last))
    throw new BadRequestException('La hora real debe estar dentro del bloque y su descanso permitido');
  if(start&&end&&end<start)throw new BadRequestException('El fin no puede ser anterior al inicio');
}

export function timingResult(record:ClassSessionRecord,data:Prisma.ClassSessionRecordUncheckedUpdateInput,start:Date|null,now:Date,actor:SessionActor) {
  const policy=record.timingPolicy as Prisma.JsonObject;
  const tolerance=policy.latenessToleranceMinutes;
  if(typeof tolerance!=='number')return;
  const state=typeof data.classState==='string'?data.classState:record.classState;
  const late=start?+start>+record.scheduledStart+tolerance*60000:+now>+record.scheduledStart+tolerance*60000;
  if(state==='SD'||state==='RE')return;
  if(state==='RN'){
    if(!start)return;
    const old=Array.isArray(data.structuredObservations)?data.structuredObservations:Array.isArray(record.structuredObservations)?record.structuredObservations:[];
    const notes=old.filter(note=>!(note&&typeof note==='object'&&!Array.isArray(note)&&note.source==='AUTO_REPLACEMENT_LATENESS'));
    if(late){
      const h=createHash('sha256').update(`late:${record.id}`).digest('hex');
      const id=`${h.slice(0,8)}-${h.slice(8,12)}-8${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
      const snapshot=(data.effectiveSnapshot??record.effectiveSnapshot) as Prisma.JsonObject;
      const person=(snapshot?.TEACHER??snapshot?.teacher) as Prisma.JsonObject|undefined;
      notes.push({id,target:'TEACHER',source:'AUTO_REPLACEMENT_LATENESS',description:`Ingreso tardío del docente reemplazante ${person?.name??person?.email??''}: ${Math.ceil((+start-+record.scheduledStart)/60000)} minutos; tolerancia ${tolerance} minutos.`,createdAt:now.toISOString(),updatedAt:now.toISOString(),author:{id:actor.id,role:actor.role}});
    }
    data.structuredObservations=notes as Prisma.InputJsonValue;
  }else if(late){data.classState='T';data.timingPolicy={...policy,automaticLateness:true} as Prisma.InputJsonValue;}
  else if(start&&policy.automaticLateness===true){data.classState='N';data.timingPolicy={...policy,automaticLateness:false} as Prisma.InputJsonValue;}
}
