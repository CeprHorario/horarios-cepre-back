import { randomUUID } from 'node:crypto';
import { SessionFilesFixture } from './helpers/session-files-fixtures';
import { OperationsService } from '../src/modules/operations/operations.service';
import { OperationsContext } from '../src/modules/operations/operations-context.service';
import { ClassSessionRecordsService } from '../src/modules/class-session-records/class-session-records.service';
import { SchemaManagerService } from '../src/database/schema-manager/schema-manger.service';
import { RequestDocuments } from '../src/modules/operations/request-document.service';
import { SessionPrincipal } from '../src/modules/class-session-records/session.types';
import { Role } from '../src/modules/auth/decorators/authorization.decorator';
const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
suite('Solicitudes: aprobaciÃ³n, reservas y excepciones diarias', () => {
  const fixture = new SessionFilesFixture();
  let service: OperationsService;
  let date: string;
  let candidate2: string;
  let recordId: number;
  beforeAll(async () => {
    await fixture.initialize();
    const db = fixture.client();
    const day = new Date();
    day.setUTCDate(day.getUTCDate() + 7);
    while (day.getUTCDay() === 0) day.setUTCDate(day.getUTCDate() + 1);
    date = day.toISOString().slice(0, 10);
    await fixture.pg.query(
      "INSERT INTO public.admission_processes(name,year,is_current,started,finished,structure_version) VALUES($1,2027,false,$2::date-7,$2::date+30,'test')",
      [fixture.schema, date],
    );
    const mon = await db.monitor.create({
      data: {
        userId: fixture.principals.monitor.userId,
        supervisorId: fixture.supervisorId,
      },
    });
    await db.class.update({
      where: { id: fixture.classId },
      data: { monitorId: mon.id },
    });
    await db.shift.create({ data: { id: 2, name: 'Otro turno' } });
    await db.hourSession.create({
      data: {
        id: 2,
        shiftId: 2,
        period: 1,
        startTime: new Date('1970-01-01T16:00Z'),
        endTime: new Date('1970-01-01T16:40Z'),
      },
    });
    candidate2 = randomUUID();
    await db.user.create({
      data: {
        id: candidate2,
        email: 'third-monitor@test.invalid',
        role: 'monitor',
      },
    });
    for (const [i, id] of [
      fixture.principals.otherMonitor.userId,
      candidate2,
    ].entries()) {
      const m = await db.monitor.create({
        data: { userId: id, supervisorId: fixture.supervisorId },
      });
      await db.class.create({
        data: {
          name: 'Other ' + i,
          idSede: 1,
          areaId: 1,
          shiftId: 2,
          monitorId: m.id,
        },
      });
    }
    const teacher = await db.teacher.create({
      data: {
        userId: fixture.principals.teacher.userId,
        courseId: 1,
        jobStatus: 'FullTime',
      },
    });
    const weekdays = [
      'Domingo',
      'Lunes',
      'Martes',
      'Miercoles',
      'Jueves',
      'Viernes',
      'Sabado',
    ] as const;
    await db.schedule.create({
      data: {
        classId: fixture.classId,
        hourSessionId: 1,
        courseId: 1,
        teacherId: teacher.id,
        weekday: weekdays[day.getUTCDay()],
      },
    });
    const record = await fixture.record();
    recordId = record.id;
    await db.classSessionRecord.update({
      where: { id: record.id },
      data: {
        date: new Date(date),
        scheduledStart: new Date(date + 'T08:00:00-05:00'),
        scheduledEnd: new Date(date + 'T08:40:00-05:00'),
        shiftEnd: new Date(date + 'T08:40:00-05:00'),
        editOpensAt: new Date(date + 'T07:55:00-05:00'),
        editDeadline: new Date(date + 'T10:10:00-05:00'),
        titularMonitorId: mon.id,
        titularTeacherId: teacher.id,
      },
    });
    const context = {
      get: async (p: SessionPrincipal) => {
        const user = await fixture
          .client(
            p.role === String(Role.ADMIN) ? fixture.coreSchema : fixture.schema,
          )
          .user.findUniqueOrThrow({
            where: { id: p.userId },
            include: { userProfile: true },
          });
        return {
          client: db,
          schema: fixture.schema,
          user,
          actor: {
            id: user.id,
            email: user.email,
            role: user.role as Role,
            origin:
              p.role === String(Role.ADMIN) ? 'core_schema' : fixture.schema,
            schema: fixture.schema,
          },
        };
      },
    } as unknown as OperationsContext;
    const records = new ClassSessionRecordsService(
      fixture.prisma,
      fixture.context,
      {} as SchemaManagerService,
    );
    const documents = {
      generate: () => Promise.resolve(Buffer.from('test-pdf')),
      upload: () =>
        Promise.resolve({
          key: 'test.pdf',
          generation: '1',
          checksum: 'a'.repeat(64),
          size: 8,
        }),
    } as unknown as RequestDocuments;
    service = new OperationsService(context, records, documents);
  }, 60000);
  afterAll(async () => {
    await fixture.pg.query(
      'DELETE FROM public.operation_notifications WHERE process_schema=$1',
      [fixture.schema],
    );
    await fixture.pg.query(
      'DELETE FROM public.admission_processes WHERE name=$1',
      [fixture.schema],
    );
    await fixture.close();
  });
  const draft = (replacementUserId: string) => ({
    operationId: randomUUID(),
    date,
    kind: 'NORMAL' as const,
    classId: fixture.classId,
    hourSessionIds: [1],
    replacementUserId,
    reason: 'Motivo documentado para prueba de reemplazo',
    compress: false,
  });
  const evidence = () => [
    { buffer: Buffer.from('mock'), size: 4 } as Express.Multer.File,
  ];
  it('no asigna al solicitar, deduplica y evita reutilizar la operaciÃ³n con otro contenido', async () => {
    const dto = draft(fixture.principals.otherMonitor.userId);
    const request = await service.create(
      fixture.principals.monitor,
      dto,
      evidence(),
    );
    expect(request.status).toBe('PENDING');
    expect(
      (
        await fixture
          .client()
          .classSessionRecord.findUniqueOrThrow({ where: { id: recordId } })
      ).monitorAccountId,
    ).toBe(fixture.principals.monitor.userId);
    expect(
      (await service.create(fixture.principals.monitor, dto, evidence())).id,
    ).toBe(request.id);
    await expect(
      service.create(
        fixture.principals.monitor,
        { ...dto, reason: 'Un motivo completamente distinto' },
        evidence(),
      ),
    ).rejects.toThrow();
    await expect(
      service.decide(fixture.principals.monitor, request.id, {
        expectedVersion: 1,
        status: 'APPROVED',
        reason: 'Autoaprobar solicitud',
      }),
    ).rejects.toThrow();
    await service.decide(fixture.principals.monitor, request.id, {
      expectedVersion: 1,
      status: 'CANCELLED',
      reason: 'Cancelar prueba inicial',
    });
  });
  it('solo admite una aprobaciÃ³n concurrente para el mismo trabajo y conserva el horario semanal', async () => {
    const before = await fixture.client().schedule.findMany();
    const a = await service.create(
      fixture.principals.monitor,
      draft(fixture.principals.otherMonitor.userId),
      evidence(),
    );
    const b = await service.create(
      fixture.principals.monitor,
      draft(candidate2),
      evidence(),
    );
    const decisions = await Promise.allSettled(
      [a, b].map((r) =>
        service.decide(fixture.principals.supervisor, r.id, {
          expectedVersion: 1,
          status: 'APPROVED',
          reason: 'Cobertura autorizada de prueba',
        }),
      ),
    );
    if (decisions.every((r) => r.status === 'rejected'))
      throw new Error(
        decisions
          .map((r) => (r.status === 'rejected' ? String(r.reason) : ''))
          .join('\n'),
      );
    expect(decisions.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(decisions.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const record = await fixture.client().classSessionRecord.findUniqueOrThrow({
      where: { id: recordId },
      include: { coverages: true },
    });
    expect(record.monitorAccountId).not.toBe(fixture.principals.monitor.userId);
    expect(
      record.coverages.filter((c) => c.status === 'AUTHORIZED'),
    ).toHaveLength(1);
    expect(record.actualStart).toBeNull();
    expect(record.actualEnd).toBeNull();
    expect(await fixture.client().schedule.findMany()).toEqual(before);
    const notifications = await service.notifications(
      fixture.principals.monitor,
      { page: 1, limit: 20 },
    );
    expect(notifications.pending).toBeGreaterThan(0);
    await service.resolveNotifications(fixture.principals.monitor);
    expect(
      (
        await service.notifications(fixture.principals.monitor, {
          page: 1,
          limit: 20,
        })
      ).pending,
    ).toBe(0);
    expect(
      (await service.detail(fixture.principals.monitor, a.id)).status,
    ).toBe(decisions[0].status === 'fulfilled' ? 'APPROVED' : 'PENDING');
  });
  it('docentes: solo administración aprueba y revalida la disponibilidad persistida', async () => {
    const db = fixture.client(),
      replacement = randomUUID();
    await db.user.create({
      data: {
        id: replacement,
        email: 'replacement-teacher@test.invalid',
        role: 'profesor',
      },
    });
    const teacher = await db.teacher.create({
      data: { userId: replacement, courseId: 1, jobStatus: 'FullTime' },
    });
    const weekday = (await db.schedule.findFirstOrThrow()).weekday;
    const availability = {
      teacherId: teacher.id,
      weekday,
      startMinute: 480,
      endMinute: 520,
    };
    await db.teacherAvailability.create({ data: availability });
    const request = await service.create(
      fixture.principals.teacher,
      draft(replacement),
      evidence(),
    );
    await expect(
      service.decide(fixture.principals.supervisor, request.id, {
        expectedVersion: 1,
        status: 'APPROVED',
        reason: 'Supervisor no aprueba docentes',
      }),
    ).rejects.toThrow();
    await expect(
      service.decide(fixture.principals.teacher, request.id, {
        expectedVersion: 1,
        status: 'APPROVED',
        reason: 'No autoaprobar docente',
      }),
    ).rejects.toThrow();
    await db.teacherAvailability.deleteMany({
      where: { teacherId: teacher.id },
    });
    await expect(
      service.decide(fixture.principals.admin, request.id, {
        expectedVersion: 1,
        status: 'APPROVED',
        reason: 'Revalidar disponibilidad actual',
      }),
    ).rejects.toThrow('disponible');
    await db.teacherAvailability.create({ data: availability });
    expect(
      (
        await service.decide(fixture.principals.admin, request.id, {
          expectedVersion: 1,
          status: 'APPROVED',
          reason: 'Reemplazo docente autorizado',
        })
      ).status,
    ).toBe('APPROVED');
    const record = await db.classSessionRecord.findUniqueOrThrow({
      where: { id: recordId },
      include: { coverages: true },
    });
    expect(record.classState).toBe('RN');
    expect(record.actualStart).toBeNull();
    expect(
      record.coverages.some(
        (c) =>
          c.kind === 'TEACHER' &&
          c.teacherId === teacher.id &&
          c.status === 'AUTHORIZED',
      ),
    ).toBe(true);
  });
});
