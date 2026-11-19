import { Prisma } from '../../generated/prisma/client';
import { SessionTx } from '../class-session-records/session.types';

export interface RequestPerson {
  id:string; name:string; email:string; dni:string|null; role:string; code:string;
  course:string|null; classId:string|null; classroom:string|null; areaId:number|null; area:string|null;
  shiftId:number|null; shift:string|null; supervisor:string|null; supervisorEmail:string|null;
}
/** Page-sized identity lookup. The authenticated account/target decides identity, never form names. */
export async function requestPeople(tx:SessionTx, ids:string[]):Promise<RequestPerson[]> {
  if(!ids.length)return [];
  return tx.$queryRaw<RequestPerson[]>`SELECT u.id,u.email,u.role,p.dni,
    COALESCE(NULLIF(BTRIM(concat_ws(' ',p.first_name,p.last_name)),''),u.email) AS name,
    split_part(u.email,'@',1) AS code,co.name AS course,c.id AS "classId",c.name AS classroom,
    c.area_id AS "areaId",a.name AS area,COALESCE(c.shift_id,own_s.shift_id) AS "shiftId",sh.name AS shift,
    COALESCE(NULLIF(BTRIM(concat_ws(' ',sp.first_name,sp.last_name)),''),su.email) AS supervisor,su.email AS "supervisorEmail"
    FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id
    LEFT JOIN teachers t ON t.user_id=u.id LEFT JOIN courses co ON co.id=COALESCE(t.course_id,CASE WHEN u.role ~ '^coordinador-[0-9]+$' THEN split_part(u.role,'-',2)::integer ELSE NULL END)
    LEFT JOIN monitors m ON m.user_id=u.id LEFT JOIN classes c ON c.monitor_id=m.id LEFT JOIN areas a ON a.id=c.area_id
    LEFT JOIN supervisors own_s ON own_s.user_id=u.id LEFT JOIN shifts sh ON sh.id=COALESCE(c.shift_id,own_s.shift_id)
    LEFT JOIN supervisors s ON s.id=m.supervisor_id LEFT JOIN users su ON su.id=s.user_id LEFT JOIN user_profiles sp ON sp.user_id=su.id
    WHERE u.id IN (${Prisma.join(ids.map(id=>Prisma.sql`${id}::uuid`))}) ORDER BY u.id`;
}
