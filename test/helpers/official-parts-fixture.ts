import { randomUUID } from 'node:crypto';
import { ClassSessionRecordsService } from '../../src/modules/class-session-records/class-session-records.service';
import { SessionFilesService } from '../../src/modules/session-files/session-files.service';
import { SessionFilesFixture } from './session-files-fixtures';

/** Visual-only synthetic snapshots match the immutable reference; never imported by src/. */
export async function seedOfficialPartsFixture(fixture:SessionFilesFixture, records:ClassSessionRecordsService, files:SessionFilesService, schema:string, ids:{monitor:string;teacher:string;replacementTeacher:string}) {
  const db=fixture.client(schema), date='2026-11-03';
  await db.userProfile.update({where:{userId:fixture.principals.monitor.userId},data:{firstName:'Camila',lastName:'Flores'}});
  const room=await db.class.create({data:{name:'Aula / Salón 203',idSede:1,areaId:1,shiftId:1}});
  const definitions=[
    ['07:00','07:40','Razonamiento matemático','Valeria Soto','valeria.soto','07:00','07:40','N'],
    ['07:45','08:25','Razonamiento matemático','Valeria Soto','valeria.soto','07:45','08:25','N'],
    ['08:30','09:10','Biología','Lucía Paredes','lucia.paredes','08:30','','N'],
    ['09:15','09:55','Biología','Lucía Paredes','lucia.paredes','09:15','09:55','RN'],
    ['10:00','10:40','Matemática','Ana Torres','ana.torres','','',''],
    ['10:45','11:25','Matemática','Ana Torres','ana.torres','','',''],
    ['11:30','12:10','Filosofía','Daniel Cruz','daniel.cruz','','','RE'],
  ];
  const at=(time:string)=>new Date(`${date}T${time}:00-05:00`);
  const seeded:number[]=[];
  for(const [index,[start,end,course,teacher,email,actualStart,actualEnd,state]] of definitions.entries()) {
    const hour=await db.hourSession.create({data:{id:3000+index,shiftId:1,period:2000+index,startTime:new Date(`1970-01-01T${start}Z`),endTime:new Date(`1970-01-01T${end}Z`)}});
    const notes=index===1 ? [{target:'TEACHER',description:'Retomó la explicación tras una pausa breve de conexión.',createdAt:at('08:12').toISOString()}] : index===3 ? [{target:'CLASSROOM',description:'Se cambió el equipo de audio del aula.',createdAt:at('09:32').toISOString()}] : index===4 ? [
      {target:'TEACHER',description:'Informó problemas de conexión al inicio del bloque.',createdAt:at('10:05').toISOString()},
      {target:'STUDENT',firstName:'Diego',lastName:'Ramírez',description:'Solicitó apoyo para acceder al enlace de clase.',createdAt:at('10:12').toISOString()},
    ] : [];
    let record=await db.classSessionRecord.create({data:{date:new Date(date),classId:room.id,hourSessionId:hour.id,shiftId:1,areaId:1,courseId:1,period:index+1,pedagogicalMinutes:40,
      scheduledStart:at(start),scheduledEnd:at(end),shiftEnd:at('12:10'),editDeadline:at('13:40'),
      titularTeacherId:ids.teacher,titularMonitorId:ids.monitor,monitorAccountId:fixture.principals.monitor.userId,supervisorId:fixture.supervisorId,
      snapshot:{className:room.name,shift:'Turno mañana',course,teacher:{id:ids.teacher,name:teacher,email:email+'@example.invalid'},monitor:{id:ids.monitor,name:'Camila Flores',email:fixture.principals.monitor.email}},timingPolicy:{},
      structuredObservations:notes.map(note=>({...note,id:randomUUID()})),
    }});
    if(index===3||index===6) await db.sessionCoverage.create({data:{recordId:record.id,kind:'TEACHER',teacherId:ids.replacementTeacher,mode:index===3?'PLANNED':'EMERGENCY',status:index===3?'AUTHORIZED':'PENDING',operationId:randomUUID(),personSnapshot:{email:index===3?'mateo.arias@example.invalid':'elena.salas@example.invalid'},requestedBy:{id:fixture.principals.monitor.userId},reason:'Referencia visual sintética'}});
    if(actualStart||state&&index!==6) record=await records.update(fixture.principals.admin,record.id,{expectedVersion:record.version,...(actualStart?{actualStart:at(actualStart).toISOString()}:{}),...(actualEnd?{actualEnd:at(actualEnd).toISOString()}:{}),classState:state,reason:'Fixture visual sintético aprobado'},true);
    if(index<4) for(const slot of ['initial','final'] as const) {
      if(index===2&&slot==='final')continue;
      const sharp=(await import('sharp')).default;
      const title=`${course} · ${slot==='initial'?start:end}`;
      const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#202638"/><rect width="640" height="32" fill="#151b2a"/><text x="18" y="22" fill="#ffffff" font-size="13" font-family="Arial">CEPRUNSA · ${title}</text><rect x="16" y="48" width="392" height="254" rx="4" fill="#f1f4f8"/><text x="38" y="92" fill="#1c2140" font-size="25" font-family="Arial">${course}</text><path d="M40 128H374M40 157H310M40 186H350M40 215H295" stroke="#b7c3d1" stroke-width="8"/>${Array.from({length:6},(_,i)=>`<rect x="${423+(i%2)*101}" y="${49+Math.floor(i/2)*86}" width="90" height="74" rx="4" fill="${['#405363','#4d4564','#3e605c'][i%3]}"/><circle cx="${468+(i%2)*101}" cy="${76+Math.floor(i/2)*86}" r="13" fill="#81909c"/><text x="${468+(i%2)*101}" y="${109+Math.floor(i/2)*86}" text-anchor="middle" fill="#ffffff" font-size="10" font-family="Arial">Ejemplo ${i+1}</text>`).join('')}<rect y="320" width="640" height="40" fill="#661124"/><text x="320" y="346" text-anchor="middle" fill="#ffffff" font-size="17" font-family="Arial">CAPTURA SINTÉTICA · HORA ${index+1}</text></svg>`;
      const buffer=await sharp(Buffer.from(svg)).png().toBuffer();
      const uploaded=await files.upload(fixture.principals.admin,record.id,{buffer,size:buffer.length,mimetype:'image/png',originalname:'visual.png'} as Express.Multer.File,true,'Captura sintética de referencia');
      record=await files.associate(fixture.principals.admin,record.id,slot,{expectedVersion:record.version,fileId:uploaded.id,reason:'Asociar referencia visual sintética'},true);
    }
    seeded.push(record.id);
  }
  return {classId:room.id,date,records:seeded};
}
