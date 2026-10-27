import { BadRequestException, ConflictException } from '@nestjs/common';
import { assertSchemaName } from '@database/schema-manager/schema-name';
import { Prisma, type PrismaClient } from '../../generated/prisma/client';
import type { CreateTeacherDto } from './dto/import-teacher.dto';

/** Compatibility adapter for /teachers/json: skip duplicates, create the remaining batch atomically. */
export async function importLegacyTeachers(
  client: PrismaClient,
  schema: string,
  dtos: CreateTeacherDto[],
) {
  assertSchemaName(schema);
  if (!Array.isArray(dtos) || dtos.length > 10000)
    throw new BadRequestException(
      'Se admite una lista de hasta 10000 docentes',
    );
  const table = (name: string) => Prisma.raw(`"${schema}"."${name}"`);
  for (let attempt = 0; ; attempt++) {
    try {
      return await client.$transaction(
        async (tx) => {
          const existingUsers = await tx.user.findMany({
            where: { email: { in: dtos.map((dto) => dto.email) } },
            select: { email: true },
          });
          const existingProfiles = await tx.userProfile.findMany({
            where: {
              dni: {
                in: dtos.flatMap((dto) => (dto.dni != null ? [dto.dni] : [])),
              },
            },
            select: { dni: true },
          });
          const emails = new Set(existingUsers.map((row) => row.email));
          const dnis = new Set(
            existingProfiles.flatMap((row) =>
              row.dni != null ? [row.dni] : [],
            ),
          );
          const accepted: object[] = [];
          const noCreados: { email: string; dni?: string; motivo: string }[] =
            [];
          for (const dto of dtos) {
            const emailExists = emails.has(dto.email);
            if (emailExists || (dto.dni != null && dnis.has(dto.dni))) {
              noCreados.push({
                email: dto.email,
                dni: dto.dni,
                motivo: emailExists ? 'email duplicado' : 'dni duplicado',
              });
              continue;
            }
            emails.add(dto.email);
            if (dto.dni != null) dnis.add(dto.dni);
            const fullTime = dto.jobStatus === 'FullTime';
            // Keep the historical endpoint's load calculation. /imports/docentes accepts maxHours explicitly.
            const maxHours = dto.isCoordinator
              ? fullTime
                ? 12
                : 16
              : fullTime
                ? 16
                : dto.courseId === 10
                  ? 21
                  : 20;
            accepted.push({
              ordinal: accepted.length,
              email: dto.email,
              dni: dto.dni ?? null,
              first_name: dto.firstName,
              last_name: dto.lastName,
              phone: dto.phone ?? null,
              personal_email: dto.personalEmail ?? null,
              phones_additional: dto.phonesAdditional ?? [],
              course_id: dto.courseId,
              max_hours: maxHours,
              is_coordinator: dto.isCoordinator ?? false,
              job_status: {
                FullTime: 'FULL_TIME',
                PartTime: 'PART_TIME',
                FreeTime: 'FREE_TIME',
              }[dto.jobStatus],
            });
          }
          if (!accepted.length) return { creados: [], noCreados };
          const creados = await tx.$queryRaw<
            { email: string; dni: string | null }[]
          >(Prisma.sql`
          WITH input AS MATERIALIZED (
            SELECT uuidv7() AS user_id,r.* FROM jsonb_to_recordset(${JSON.stringify(accepted)}::jsonb)
            AS r(ordinal integer,email text,dni text,first_name text,last_name text,phone text,personal_email text,
              phones_additional text[],course_id smallint,max_hours smallint,is_coordinator boolean,job_status text)
          ), inserted_users AS (
            INSERT INTO ${table('users')}(id,email,role) SELECT user_id,email,'profesor' FROM input RETURNING id,email
          ), inserted_profiles AS (
            INSERT INTO ${table('user_profiles')}(user_id,dni,first_name,last_name,phone,personal_email,phones_additional)
            SELECT i.user_id,i.dni,i.first_name,i.last_name,i.phone,i.personal_email,i.phones_additional FROM input i
              JOIN inserted_users u ON u.id=i.user_id RETURNING user_id,dni
          ), inserted_teachers AS (
            INSERT INTO ${table('teachers')}(user_id,course_id,max_hours,job_status,is_coordinator)
            SELECT i.user_id,i.course_id,i.max_hours,i.job_status::${table('job_statuses')},i.is_coordinator
              FROM input i JOIN inserted_users u ON u.id=i.user_id RETURNING user_id
          ) SELECT u.email,p.dni FROM inserted_users u JOIN inserted_profiles p ON p.user_id=u.id
            JOIN inserted_teachers t ON t.user_id=u.id JOIN input i ON i.user_id=u.id ORDER BY i.ordinal
        `);
          return { creados, noCreados };
        },
        { isolationLevel: 'Serializable', timeout: 30000 },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2034' && attempt < 3) continue;
        if (
          error.code === 'P2034' ||
          error.code === 'P2002' ||
          (error.code === 'P2010' && error.meta?.code === '23505')
        ) {
          throw new ConflictException(
            'Los datos cambiaron o hay un correo/DNI repetido; vuelve a enviar el lote. No se creó ningún docente nuevo',
          );
        }
        throw new BadRequestException(
          'Datos de importación inválidos; no se creó ningún docente nuevo',
          { cause: error },
        );
      }
      throw error;
    }
  }
}
