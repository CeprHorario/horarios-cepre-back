import ExcelJS from 'exceljs';
import { AvailabilityWorkbook } from './availability-workbook.service';
import { OperationsContext } from './operations-context.service';
import { ScheduleService } from '../schedules/schedules.service';
import { Role } from '../auth/decorators/authorization.decorator';
describe('Disponibilidad por docente y proceso', () => {
  const principal = {
    userId: 'teacher-account',
    email: 'teacher@test.invalid',
    role: Role.TEACHER,
  };
  const teacher = { id: 'teacher-id', userId: principal.userId, user: {email:principal.email,userProfile:{firstName:'Ana',lastName:'Prueba'}}, courses:{name:'Matemática'} };
  const hours = [
    {
      id: 1,
      period: 1,
      shiftId: 1,
      startTime: new Date('1970-01-01T08:00Z'),
      endTime: new Date('1970-01-01T08:40Z'),
      shift: { name: 'Turno 01' },
    },
    {
      id: 2,
      period: 1,
      shiftId: 2,
      startTime: new Date('1970-01-01T16:00Z'),
      endTime: new Date('1970-01-01T16:40Z'),
      shift: { name: 'Turno 02' },
    },
  ];
  function service(userId = principal.userId, target = teacher, role = Role.TEACHER) {
    return new AvailabilityWorkbook(
      {
        get: () => Promise.resolve({
          schema: 'test_process',
          user: { id: userId },
          actor: { role },
          client: {
            teacher: { findFirst: () => Promise.resolve(target) },
            hourSession: { findMany: () => Promise.resolve(hours) },
          },
        }),
      } as unknown as OperationsContext,
      { getAvailability: () => Promise.resolve([]) } as unknown as ScheduleService,
    );
  }
  const file = (buffer: Buffer) =>
    ({
      buffer,
      size: buffer.length,
      originalname: 'disponibilidad.xlsx',
    }) as Express.Multer.File;
  async function book() {
    const s = service(),
      b = new ExcelJS.Workbook();
    await b.xlsx.load(
      (await s.template(principal, 'me')) as unknown as Parameters<
        typeof b.xlsx.load
      >[0],
    );
    return { s, b };
  }
  it('genera todos los turnos y usa valores, no colores, para registrar', async () => {
    const { s, b } = await book();
    const sheet = b.getWorksheet('Disponibilidad')!;
    expect(sheet.rowCount).toBe(3);
    expect(sheet.getCell('E2').dataValidation.type).toBe('list');
    sheet.getCell('E2').value = true;
    sheet.getCell('F2').value = 'No disponible';
    sheet.getCell('F2').fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF00FF00' },
    };
    const result = await s.preview(
      principal,
      'me',
      file(Buffer.from(await b.xlsx.writeBuffer())),
    );
    expect(result.valid).toBe(true);
    expect(result.intervals).toEqual([
      { weekday: 'Lunes', start: '08:00', end: '08:40' },
    ]);
  });
  it('muestra la celda inválida y rechaza bloques editados', async () => {
    const { s, b } = await book();
    const sheet = b.getWorksheet('Disponibilidad')!;
    sheet.getCell('E2').value = '08 a 10';
    sheet.getCell('C3').value = '15:00';
    const result = await s.preview(
      principal,
      'me',
      file(Buffer.from(await b.xlsx.writeBuffer())),
    );
    expect(result.valid).toBe(false);
    expect(result.rows[0].errors.join()).toContain('E2');
    expect(result.rows[1].errors.join()).toContain('B3:D3');
  });
  it('rechaza reutilizar la plantilla de otro proceso', async () => {
    const { s, b } = await book();
    b.getWorksheet('Guía')!.getCell('B1').value = 'otro_proceso';
    await expect(
      s.preview(principal, 'me', file(Buffer.from(await b.xlsx.writeBuffer()))),
    ).rejects.toThrow('otro proceso');
  });
  it('comparte la misma plantilla y muestra el destino real, sin usar nombres para vincular', async () => {
    const {b}=await book();
    const guide=b.getWorksheet('Guía')!;
    expect(guide.getCell('A2').text).toBe('Docente (referencia)');
    expect(guide.getCell('B2').text).toBe('Ana Prueba');
    expect(guide.getCell('B3').text).toBe('Matemática');
    guide.getCell('B2').value='Nombre de otra persona';
    guide.getCell('B3').value='Curso informativo';
    b.getWorksheet('Disponibilidad')!.getCell('E2').value='Disponible';
    const target={...teacher,id:'other-teacher-id',userId:'other-account',user:{email:'other@test.invalid',userProfile:{firstName:'Luis',lastName:'Destino'}},courses:{name:'Física'}};
    const result=await service(target.userId,target).preview({...principal,userId:target.userId},'me',file(Buffer.from(await b.xlsx.writeBuffer())));
    expect(result.valid).toBe(true);
    expect(result.teacherId).toBe(target.id);
    expect(result.teacher).toEqual({id:target.id,name:'Luis Destino',course:'Física'});
    expect(result.intervals).toEqual([{weekday:'Lunes',start:'08:00',end:'08:40'}]);
  });
  it('impide que un docente gestione a otro', async () => {
    await expect(
      service('another-account').template(principal, 'teacher-id'),
    ).rejects.toThrow('tu disponibilidad');
  });
  it('personaliza la ficha administrativa y conserva la plantilla general sin nombres', async () => {
    const b=new ExcelJS.Workbook();
    await b.xlsx.load(await service('admin',teacher,Role.ADMIN).template({...principal,userId:'admin',role:Role.ADMIN},teacher.id) as never);
    expect(b.getWorksheet('Guía')!.getCell('B2').text).toBe('Ana Prueba');
    expect(b.getWorksheet('Guía')!.getCell('B3').text).toBe('Matemática');
    await b.xlsx.load(await service('admin',teacher,Role.ADMIN).template({...principal,userId:'admin',role:Role.ADMIN},'general') as never);
    expect(b.getWorksheet('Guía')!.getCell('B2').text).toBe('');
  });
});
