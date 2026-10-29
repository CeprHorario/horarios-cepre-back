import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { ClassSessionRecordsService } from './class-session-records.service';
import { SessionPrincipal } from './session.types';
import { SessionQueryDto } from './session.dto';

@Injectable()
export class SessionReportsService {
  constructor(private readonly records: ClassSessionRecordsService) {}
  async report(
    principal: SessionPrincipal,
    query: SessionQueryDto,
    summary = false,
  ) {
    const { client, actor } = await this.records.context(principal);
    this.records.admin(actor);
    this.records.range(query);
    const view = Prisma.raw(`"${actor.schema}".v_class_session_records_report`);
    const filters = Prisma.sql`date BETWEEN ${new Date(query.from)}::date AND ${new Date(query.to)}::date
      ${query.includeDeleted === 'true' ? Prisma.empty : Prisma.sql`AND deleted_at IS NULL`}
      ${query.classId ? Prisma.sql`AND class_id=${query.classId}::uuid` : Prisma.empty}
      ${query.teacherId ? Prisma.sql`AND effective_teacher_id=${query.teacherId}::uuid` : Prisma.empty}
      ${query.monitorId ? Prisma.sql`AND titular_monitor_id=${query.monitorId}::uuid` : Prisma.empty}
      ${query.shiftId ? Prisma.sql`AND shift_id=${query.shiftId}` : Prisma.empty}
      ${query.courseId ? Prisma.sql`AND course_id=${query.courseId}` : Prisma.empty}
      ${query.pendingReview === 'true' ? Prisma.sql`AND review_status='PENDING'` : Prisma.empty}`;
    if (summary) {
      const [totals] = await client.$queryRaw<
        Record<string, number>[]
      >(Prisma.sql`
        SELECT COUNT(*)::int AS records,COUNT(*) FILTER(WHERE titular_absent)::int AS absent_blocks,
          COUNT(DISTINCT (date,titular_teacher_id)) FILTER(WHERE titular_absent)::int AS absent_teacher_days,
          COUNT(*) FILTER(WHERE teacher_replacement_authorization='AUTHORIZED')::int AS authorized_replacement_blocks,
          COUNT(*) FILTER(WHERE effective_teacher_id IS NOT NULL AND effective_teacher_id IS DISTINCT FROM titular_teacher_id AND teaching_status='TAUGHT')::int AS executed_replacement_blocks,
          COUNT(*) FILTER(WHERE teacher_replacement_authorization='PENDING')::int AS pending_replacement_blocks,
          COUNT(*) FILTER(WHERE timing_kind='ARRIVAL' AND timing_classification='LATE')::int AS late_arrivals,
          COUNT(*) FILTER(WHERE timing_kind='RESUMPTION' AND timing_classification='LATE')::int AS late_resumptions,
          COUNT(*) FILTER(WHERE NULLIF(BTRIM(incidents),'') IS NOT NULL)::int AS incident_records,
          COUNT(*) FILTER(WHERE completeness='INCOMPLETE')::int AS incomplete_records,
          COUNT(*) FILTER(WHERE review_status='PENDING')::int AS pending_reviews,
          COALESCE(SUM(scheduled_minutes),0)::float8 AS scheduled_minutes,
          SUM(actual_minutes)::float8 AS actual_minutes,SUM(actual_clock_hours)::float8 AS actual_clock_hours
        FROM ${view} WHERE ${filters}`);
      return totals;
    }
    const [data, total] = await client.$transaction([
      client.$queryRaw(
        Prisma.sql`SELECT * FROM ${view} WHERE ${filters} ORDER BY date,scheduled_start,id LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
      ),
      client.$queryRaw<{ total: number }[]>(
        Prisma.sql`SELECT COUNT(*)::int AS total FROM ${view} WHERE ${filters}`,
      ),
    ]);
    return {
      data,
      total: total[0].total,
      page: query.page,
      limit: query.limit,
    };
  }
}
