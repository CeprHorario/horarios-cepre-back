import {timingResult,enforceBlockTimes} from './session-timing';
import {Role} from '../auth/decorators/authorization.decorator';
import type {ClassSessionRecord,Prisma} from '../../generated/prisma/client';
import type {SessionActor} from './session.types';
describe('Tolerancia y horas de un bloque',()=>{
 const actor={id:'monitor',role:Role.MONITOR} as SessionActor;
 const record={id:1,classState:'N',scheduledStart:new Date('2026-11-19T21:00Z'),scheduledEnd:new Date('2026-11-19T21:40Z'),timingPolicy:{latenessToleranceMinutes:3,breakMinutes:5},structuredObservations:[],effectiveSnapshot:{TEACHER:{name:'Docente Reemplazante'}}} as unknown as ClassSessionRecord;
 it('acepta el bloque y descanso, rechaza horas ajenas y fin invertido',()=>{
   expect(()=>enforceBlockTimes(record,new Date('2026-11-19T21:00Z'),new Date('2026-11-19T21:45Z'))).not.toThrow();
   for(const value of ['2026-11-19T20:59Z','2026-11-19T21:46Z'])expect(()=>enforceBlockTimes(record,new Date(value),null)).toThrow();
   expect(()=>enforceBlockTimes(record,new Date('2026-11-19T21:20Z'),new Date('2026-11-19T21:10Z'))).toThrow();
 });
 it('respeta el límite exacto y genera T fuera de tolerancia',()=>{
   const data:Prisma.ClassSessionRecordUncheckedUpdateInput={};timingResult(record,data,new Date('2026-11-19T21:03Z'),new Date('2026-11-19T22:00Z'),actor);expect(data.classState).toBeUndefined();
   timingResult(record,data,new Date('2026-11-19T21:04Z'),new Date('2026-11-19T22:00Z'),actor);expect(data.classState).toBe('T');
 });
 it('conserva RN y genera una sola observación del reemplazante; RE no cambia',()=>{
   const data:Prisma.ClassSessionRecordUncheckedUpdateInput={classState:'RN'};timingResult(record,data,new Date('2026-11-19T21:06Z'),new Date('2026-11-19T22:00Z'),actor);
   expect(data.classState).toBe('RN');expect(JSON.stringify(data.structuredObservations)).toContain('Docente Reemplazante');
   timingResult(record,data,new Date('2026-11-19T21:07Z'),new Date('2026-11-19T22:00Z'),actor);expect((data.structuredObservations as unknown[]).length).toBe(1);
   const emergency:Prisma.ClassSessionRecordUncheckedUpdateInput={classState:'RE'};timingResult(record,emergency,new Date('2026-11-19T21:07Z'),new Date('2026-11-19T22:00Z'),actor);expect(emergency).toEqual({classState:'RE'});
 });
});
