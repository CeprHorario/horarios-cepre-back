import { PrismaClient } from '@prisma/client';
import { Pool, PoolClient } from 'pg';

import * as rawData from './initial.json';
import * as rawCourses from './courses.json';
import * as areaCourseHr from './area-course-hrs.json';
//import * as schedulesBio from './data/bio.json';
//import * as schedulesIng from './data/ing.json';
//import * as schedulesSoc from './data/soc.json';
//import * as schema from '@database/drizzle/schema';
//import { dataCorreos } from './utils';
import {
  ProcessAdmissionDto,
  ShiftDetailDto,
} from '@modules/admissions/dto/create-admission.dto';
import { AreaCourse, AreaCourseHours, Course, DataInitial } from './type';
import { assignNumericIds, assignUuidIds, validateShiftTimes } from './utils';

// type DataUsersClass = {
//   sede: Sede;
//   area: Area;
//   shift: Shift;
//   users: User[];
//   monitors: string[];
// };

const pool = (schema: string): Pool => {
  return new Pool({
    connectionString: `${process.env.DATABASE_URL}?schema=${schema}`,
  });
};

export const initialDataSchema = async (
  schema: string,
  body: ProcessAdmissionDto,
  client: PrismaClient,
) => {
  const db = await pool(schema).connect();
  await client.$executeRaw`select 1`;

  const { sedes, areas, shifts } = await createBasicData(
    db,
    body.configuration.shifts,
  );



  
};

/**
 * Creates the initial data for the database.
 */
const createBasicData = async (
  pool: PoolClient,
  shiftsBody: ShiftDetailDto[],
) => {
  // Destructure the data from the JSON files
  const { users, areas, sedes } = rawData as DataInitial;
  const { courses } = rawCourses as { courses: Course[] };
  const { areaCourse } = areaCourseHr as { areaCourse: AreaCourseHours[] };

  try {
    // asingIds(users, areas, sedes, courses);
    // Assign IDs to all data entities
    const usersWithIds = assignUuidIds(users);
    const areasWithIds = assignNumericIds(areas);
    const sedesWithIds = assignNumericIds(sedes);
    const coursesWithIds = assignNumericIds(courses);

    // Validate and assign IDs to shifts
    const shiftsWithIds = shiftsBody.map((shift) => validateShiftTimes(shift));
    // Assign hours to areas and courses
    const areaCourseHours: AreaCourse[] = areaCourse.flatMap((area) => {
      const areaId = areasWithIds.find((a) => a.name === area.area)?.id;
      return area.hours.map((course) => {
        const courseId = coursesWithIds.find(
          (c) => c.name === course.course,
        )?.id;
        return {
          areaId: areaId ?? 0,
          courseId: courseId ?? 0,
          totalHours: parseInt(course.total),
        };
      });
    });

    // Crear consultas para todas las tablas de una forma más concisa
    const tablesToInsert = [
      { table: 'users', data: usersWithIds },
      { table: 'areas', data: areasWithIds },
      { table: 'sedes', data: sedesWithIds },
      { table: 'courses', data: coursesWithIds },
      { table: 'shifts', data: shiftsWithIds },
      { table: 'area_course_hours', data: areaCourseHours },
    ];

    // Crear consultas de inserción para cada tabla
    const queries = tablesToInsert.map((t) =>
      createInsertQuery(
        t.table,
        extractColumnsSql(t.data),
        extractValuesSql(t.data),
      ),
    );

    // Concatenar todas las consultas en una sola
    //await pool.query(concatQuery(queries));
    console.log(concatQuery(queries));

    await pool.query('select 1');

    /* await new Promise((resolve, reject) => {
      pool.query(concatQuery(queries), (err) => {
        if (err) {
          console.error('Error executing query', err.stack);
          reject(err);
        } else {
          resolve(true);
        }
      });
    }); */
    return {
      sedes: sedesWithIds,
      areas: areasWithIds,
      shifts: shiftsWithIds,
    };
  } catch (error) {
    console.error('Error creating data', error);
    throw new Error('Error creating data');
  }
};

/**
 * Generates an SQL insert query for a given table, columns, and values.
 */
const createInsertQuery = (
  table: string,
  columnsSQL: string,
  valuesSQL: string,
): string => {
  return `INSERT INTO "${table}" (${columnsSQL}) VALUES\n${valuesSQL};`;
};

/**
 * Concatenates multiple SQL queries into a single string.
 */
const concatQuery = (queries: string[]): string => {
  return queries.filter((q) => q).join('\n\n');
};

/**
 * Generates an SQL insert query for a given table, columns, and values.
 */
const extractColumnsSql = (obj: object[]): string => {
  return Object.keys(obj[0])
    .map((col: string) => `"${col}"`)
    .join(', ');
};

/**
 * Generates an SQL insert query for a given table, columns, and values.
 */
const extractValuesSql = (obj: object[]) => {
  return obj
    .map((row) => {
      const values = Object.values(row).map(formatSqlValue).join(', ');
      return `(${values})`;
    })
    .join(',\n');
};

/**
 * Formatea un valor para su uso en una consulta SQL
 */
const formatSqlValue = (value: any): string => {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return value.toString();
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date) return `'${value.toISOString()}'`;
  return `'${String(value).replace(/'/g, "''")}'`; // para Strings
};
