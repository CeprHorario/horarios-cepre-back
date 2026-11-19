import { limaDate } from '../class-session-records/session-journal.service';
import { OperationsContext } from '../operations/operations-context.service';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { Role } from '@modules/auth/decorators/authorization.decorator';
import { ClassSessionRecordsService } from '../class-session-records/class-session-records.service';
import {
  SessionActor,
  SessionPrincipal,
  SessionTx,
} from '../class-session-records/session.types';
import {
  CreateIncidenceDto,
  IncidencePeopleQuery,
  IncidenceQuery,
  ResolveIncidenceDto,
} from './incidences.dto';

type Incident = {
  id: string;
  subject_dni: string;
  subject_role: string;
  subject_account_id: string;
  subject_name: string;
  process_schema: string;
  record_id: number | null;
  class_id: string | null;
  title: string;
  description: string;
  occurred_at: Date;
  actor_id: string;
  actor_origin: string;
  status: string;
  version: number;
  seen_at: Date | null;
  created_at: Date;
};
const fields = Prisma.sql`i.id,i.subject_dni,i.subject_role,i.subject_account_id,i.subject_name,i.process_schema,i.record_id,i.class_id,i.title,i.description,i.occurred_at,i.actor_id,i.actor_origin,i.status,i.version,i.seen_at,i.created_at`;

@Injectable()
export class IncidencesService {
  constructor(private readonly records: ClassSessionRecordsService, private readonly contexts: OperationsContext) {}

  private context(principal: SessionPrincipal) {
    return principal.role === Role.COORDINATOR
      ? this.contexts.get(principal)
      : this.records.context(principal);
  }

  async readContext(principal: SessionPrincipal) {
    const { actor } = await this.context(principal);
    if (![Role.ADMIN, Role.SUPERVISOR, Role.COORDINATOR].includes(actor.role as Role))
      throw new ForbiddenException('Rol sin lectura de incidencias');
    return { accountId: actor.id, process: actor.schema, role: actor.role, serverNow: new Date().toISOString() };
  }

  async dniSummary(principal: SessionPrincipal, dnis: string[]) {
    const { client, actor } = await this.records.context(principal);
    this.records.admin(actor);
    if (!dnis.length) return [];
    return client.$queryRaw<{ dni: string; total: number; pending: number }[]>`
      SELECT subject_dni AS dni, count(*)::int AS total,
        count(*) FILTER (WHERE status='OPEN')::int AS pending
      FROM public.person_incidences WHERE subject_dni IN (${Prisma.join(dnis)})
      GROUP BY subject_dni ORDER BY subject_dni`;
  }

  private async scope(
    tx: SessionTx,
    actor: SessionActor,
    query: IncidencePeopleQuery,
  ): Promise<Prisma.UserWhereInput> {
    if (actor.role === Role.ADMIN)
      return { ...(query.subjectRole==='coordinador'?{role:{startsWith:'coordinador'}}:{role:query.subjectRole}), isActive: true };
    if (actor.role === Role.MONITOR) {
      if (query.subjectRole !== String(Role.TEACHER) || !query.recordId)
        throw new ForbiddenException(
          'Selecciona un parte propio para reportar a su docente',
        );
      const record = await this.records.authorizeRecord(
        tx,
        actor,
        query.recordId,
      );
      const ids = [
        ...new Set(
          [record.effectiveTeacherId, record.titularTeacherId].filter(
            (value): value is string => Boolean(value),
          ),
        ),
      ];
      return {
        isActive: true,
        role: Role.TEACHER,
        teacher: { id: { in: ids } },
      };
    }
    if (
      actor.role !== Role.SUPERVISOR ||
      query.subjectRole !== String(Role.MONITOR)
    )
      throw new ForbiddenException('No puede reportar ese rol');
    const supervisor = await tx.supervisor.findUnique({
      where: { userId: actor.id },
    });
    if (!supervisor) throw new ForbiddenException('Supervisor no registrado');
    if (query.subjectRole === String(Role.MONITOR))
      return {
        role: Role.MONITOR,
        isActive: true,
        monitor: { supervisorId: supervisor.id },
      };
    return {
      role: Role.TEACHER,
      isActive: true,
      teacher: {
        schedules: {
          some: { clas: { monitor: { supervisorId: supervisor.id } } },
        },
      },
    };
  }

  async people(principal: SessionPrincipal, query: IncidencePeopleQuery) {
    const { client, actor } = await this.records.context(principal);
    return this.records.transaction(client, actor.schema, async (tx) => {
      if(actor.role===Role.ADMIN && query.subjectRole==='administrador') {
        const search='%'+(query.search??'')+'%';
        const where=Prisma.sql`u.is_active AND u.role='administrador' AND (u.email ILIKE ${search} OR p.dni ILIKE ${search} OR concat_ws(' ',p.first_name,p.last_name) ILIKE ${search})`;
        const [data,total]=await Promise.all([tx.$queryRaw`SELECT u.id,COALESCE(NULLIF(BTRIM(concat_ws(' ',p.first_name,p.last_name)),''),u.email) AS name,p.dni,u.role FROM core_schema.users u LEFT JOIN core_schema.user_profiles p ON p.user_id=u.id WHERE ${where} ORDER BY u.id LIMIT 25 OFFSET ${(query.page-1)*25}`,tx.$queryRaw<{total:number}[]>`SELECT count(*)::int total FROM core_schema.users u LEFT JOIN core_schema.user_profiles p ON p.user_id=u.id WHERE ${where}`]);
        return {data,total:total[0].total,page:query.page,limit:25};
      }
      const scoped = await this.scope(tx, actor, query);
      const where: Prisma.UserWhereInput = {
        AND: [
          scoped,
          ...(query.search
            ? [
                {
                  OR: [
                    {
                      email: {
                        contains: query.search,
                        mode: 'insensitive' as const,
                      },
                    },
                    { userProfile: { dni: { contains: query.search } } },
                    {
                      userProfile: {
                        firstName: {
                          contains: query.search,
                          mode: 'insensitive' as const,
                        },
                      },
                    },
                    {
                      userProfile: {
                        lastName: {
                          contains: query.search,
                          mode: 'insensitive' as const,
                        },
                      },
                    },
                  ],
                },
              ]
            : []),
        ],
      };
      const [users, total] = await Promise.all([
        tx.user.findMany({
          where,
          include: { userProfile: true },
          take: 25,
          skip: (query.page - 1) * 25,
          orderBy: { id: 'asc' },
        }),
        tx.user.count({ where }),
      ]);
      return {
        data: users.map((u) => ({
          id: u.id,
          name:
            [u.userProfile?.firstName, u.userProfile?.lastName]
              .filter(Boolean)
              .join(' ') || u.email,
          dni: u.userProfile?.dni ?? null,
          role: u.role,
        })),
        total,
        page: query.page,
        limit: 25,
      };
    });
  }

  async create(principal: SessionPrincipal, dto: CreateIncidenceDto) {
    const { client, actor } = await this.records.context(principal);
    if (actor.role === Role.MONITOR)
      throw new ForbiddenException(
        'El monitor registra las incidencias en las observaciones del parte',
      );
    return this.records.transaction(client, actor.schema, async (tx) => {
      const where = await this.scope(tx, actor, {
        subjectRole: dto.subjectRole,
        recordId: dto.recordId,
        page: 1,
      });
      const subject = dto.subjectRole==='administrador' && actor.role===Role.ADMIN ? (await tx.$queryRaw<{id:string;email:string;userProfile:{dni:string;firstName:string;lastName:string}|null}[]>`SELECT u.id,u.email,CASE WHEN p.user_id IS NULL THEN NULL ELSE jsonb_build_object('dni',p.dni,'firstName',p.first_name,'lastName',p.last_name) END AS "userProfile" FROM core_schema.users u LEFT JOIN core_schema.user_profiles p ON p.user_id=u.id WHERE u.id=${dto.subjectAccountId}::uuid AND u.is_active AND u.role='administrador'`)[0] : await tx.user.findFirst({
        where: { AND: [where, { id: dto.subjectAccountId }] },
        include: { userProfile: true },
      });
      if (!subject)
        throw new NotFoundException('Persona no disponible para tu alcance');
      const dni = subject.userProfile?.dni;
      if (!dni || !/^\d{8}$/.test(dni))
        throw new BadRequestException(
          'Completa el DNI de la persona antes de registrar su incidencia',
        );
      const now = await this.records.now(tx),
        occurredAt = new Date(dto.occurredAt);
      if (actor.role === Role.SUPERVISOR && (dto.subjectRole !== String(Role.MONITOR) || limaDate(occurredAt) !== limaDate(now))) throw new ForbiddenException('Solo puedes reportar a tus monitores por hechos del día actual de Lima');
      if (occurredAt > now)
        throw new BadRequestException(
          'La incidencia no puede tener una fecha futura',
        );
      let classId: string | null = null;
      let writeWindow = Prisma.sql`true`;
      if (dto.recordId) {
        await this.records.lock(tx, dto.recordId);
        const record = await this.records.authorizeRecord(
          tx,
          actor,
          dto.recordId,
        );
        classId = record.classId;
        if (actor.role === Role.MONITOR) {
          await this.records.assertWritable(tx, actor, record);
          if (
            occurredAt < record.scheduledStart ||
            occurredAt > record.scheduledEnd
          )
            throw new BadRequestException(
              'La hora de la incidencia debe estar dentro del bloque del docente',
            );
          writeWindow = Prisma.sql`clock_timestamp() >= ${this.records.editStartsAt(record)} AND clock_timestamp() < ${record.editDeadline}`;
        }
      } else if (actor.role === Role.MONITOR)
        throw new ForbiddenException(
          'El monitor reporta desde un parte propio',
        );
      const name =
        [subject.userProfile?.firstName, subject.userProfile?.lastName]
          .filter(Boolean)
          .join(' ') || subject.email;
      const title = dto.title.trim(),
        description = dto.description.trim();
      if (title.length < 3 || description.length < 3)
        throw new BadRequestException(
          'Título y observaciones requieren al menos 3 caracteres',
        );
      await tx.$executeRaw`INSERT INTO public.person_incidences(id,subject_dni,subject_role,subject_account_id,subject_name,process_schema,record_id,class_id,title,description,occurred_at,actor,actor_id,actor_origin)
        SELECT ${dto.operationId}::uuid,${dni},${dto.subjectRole},${subject.id}::uuid,${name},${actor.schema},${dto.recordId ?? null},${classId}::uuid,${title},${description},${occurredAt},${JSON.stringify(actor)}::jsonb,${actor.id}::uuid,${actor.origin} WHERE ${writeWindow} ON CONFLICT(id) DO NOTHING`;
      const [saved] = await tx.$queryRaw<
        Incident[]
      >`SELECT ${fields} FROM public.person_incidences i WHERE i.id=${dto.operationId}::uuid FOR UPDATE`;
      if (!saved)
        throw new ForbiddenException(
          'Plazo cerrado: solo administración puede registrar la corrección',
        );
      if (
        saved.actor_id !== actor.id ||
        saved.actor_origin !== actor.origin ||
        saved.process_schema !== actor.schema ||
        saved.subject_account_id !== subject.id ||
        saved.subject_dni !== dni ||
        saved.subject_role !== dto.subjectRole ||
        saved.record_id !== (dto.recordId ?? null) ||
        saved.title !== title ||
        saved.description !== description ||
        +saved.occurred_at !== +occurredAt
      )
        throw new ConflictException(
          'La operación ya corresponde a otra incidencia',
        );
      await tx.$executeRaw`INSERT INTO public.person_incidence_events(incidence_id,action,actor,reason) SELECT ${saved.id}::uuid,'CREATED',${JSON.stringify(actor)}::jsonb,NULL WHERE NOT EXISTS(SELECT 1 FROM public.person_incidence_events WHERE incidence_id=${saved.id}::uuid AND action='CREATED')`;
      return saved;
    });
  }

  private async where(
    tx: SessionTx,
    actor: SessionActor,
    query: IncidenceQuery,
  ) {
    const conditions: Prisma.Sql[] = [];
    if (actor.role === Role.COORDINATOR) {
      conditions.push(Prisma.sql`i.process_schema=${actor.schema}`);
    } else if (actor.role !== Role.ADMIN) {
      if (actor.role !== Role.SUPERVISOR)
        throw new ForbiddenException(
          'El monitor registra incidencias desde su parte; no consulta el historial',
        );
      const profile = await tx.userProfile.findUnique({
        where: { userId: actor.id },
      });
      conditions.push(Prisma.sql`i.subject_role='monitor' AND i.process_schema=${actor.schema}
        AND i.subject_account_id<>${actor.id}::uuid
        AND EXISTS (SELECT 1 FROM monitors m JOIN supervisors s ON s.id=m.supervisor_id
          JOIN user_profiles p ON p.user_id=m.user_id JOIN users u ON u.id=m.user_id
          WHERE s.user_id=${actor.id}::uuid AND u.is_active AND p.dni=i.subject_dni)`);
      if (profile?.dni)
        conditions.push(Prisma.sql`i.subject_dni<>${profile.dni}`);
    }
    if (query.dni) {
      if (![Role.ADMIN, Role.COORDINATOR].includes(actor.role as Role))
        throw new ForbiddenException('El historial por DNI es administrativo');
      conditions.push(Prisma.sql`i.subject_dni=${query.dni}`);
    }
    if (query.status) conditions.push(Prisma.sql`i.status=${query.status}`);
    return conditions.length
      ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
      : Prisma.empty;
  }

  async list(principal: SessionPrincipal, query: IncidenceQuery) {
    const { client, actor } = await this.context(principal);
    return this.records.transaction(client, actor.schema, async (tx) => {
      const where = await this.where(tx, actor, query);
      const [data, count] = await Promise.all([
        tx.$queryRaw<
          Incident[]
        >`SELECT ${fields} FROM public.person_incidences i ${where} ORDER BY i.created_at DESC,i.id DESC LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
        tx.$queryRaw<
          { total: number }[]
        >`SELECT count(*)::int AS total FROM public.person_incidences i ${where}`,
      ]);
      return {
        data,
        total: count[0].total,
        page: query.page,
        limit: query.limit,
      };
    });
  }

  async warnings(principal: SessionPrincipal) {
    const { client, actor } = await this.records.context(principal);
    this.records.admin(actor);
    const [row] = await client.$queryRaw<
      { total: number; profesor: number; monitor: number; supervisor: number }[]
    >`SELECT count(*)::int AS total,count(*) FILTER(WHERE subject_role='profesor')::int AS profesor,count(*) FILTER(WHERE subject_role='monitor')::int AS monitor,count(*) FILTER(WHERE subject_role='supervisor')::int AS supervisor FROM public.person_incidences WHERE status='OPEN'`;
    return row;
  }

  async resolve(
    principal: SessionPrincipal,
    id: string,
    dto: ResolveIncidenceDto,
  ) {
    const { client, actor } = await this.records.context(principal);
    this.records.admin(actor);
    return this.records.transaction(client, actor.schema, async (tx) => {
      const rows = await tx.$queryRaw<
        Incident[]
      >`SELECT ${fields} FROM public.person_incidences i WHERE id=${id}::uuid FOR UPDATE`;
      if (!rows[0]) throw new NotFoundException('Incidencia no encontrada');
      if (rows[0].version !== dto.expectedVersion)
        throw new ConflictException('La incidencia cambió; vuelve a cargarla');
      if (dto.reason.trim().length < 3)
        throw new BadRequestException('Se requiere un motivo');
      await tx.$executeRaw`UPDATE public.person_incidences SET status=${dto.status},version=version+1 WHERE id=${id}::uuid`;
      await tx.$executeRaw`INSERT INTO public.person_incidence_events(incidence_id,action,actor,reason) VALUES(${id}::uuid,${dto.status},${JSON.stringify(actor)}::jsonb,${dto.reason.trim()})`;
      return { id, status: dto.status, version: dto.expectedVersion + 1 };
    });
  }

  async history(principal: SessionPrincipal, id: string) {
    const { client, actor } = await this.context(principal);
    if (actor.role === Role.COORDINATOR) {
      const [incident] = await client.$queryRaw<{id:string}[]>`SELECT id FROM public.person_incidences WHERE id=${id}::uuid AND process_schema=${actor.schema}`;
      if (!incident) throw new NotFoundException('Incidencia no encontrada');
    } else this.records.admin(actor);
    return client.$queryRaw`SELECT id,action,reason,created_at FROM public.person_incidence_events WHERE incidence_id=${id}::uuid ORDER BY id`;
  }
}
