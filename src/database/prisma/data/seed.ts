import { PrismaClient, Class } from '@prisma/client';
import { Pool, PoolClient } from 'pg';

import * as rawData from './initial.json';
import * as rawCourses from './courses.json';
import * as areaCourseHr from './area-course-hrs.json';
//import * as schedulesBio from './schedules/bio.json';
//import * as schedulesIng from './schedules/ing.json';
//import * as schedulesSoc from './schedules/soc.json';
//import * as schema from '@database/drizzle/schema';
//import { dataCorreos } from './utils';
import {
  ConfigurationDto,
  ShiftDetailDto,
} from '@modules/admissions/dto/create-admission.dto';
import {
  AreaCourse,
  AreaCourseHours,
  Course,
  DataInitial,
  DataMonitor,
} from './type';
import {
  arrayMonitors,
  assignNumericIds,
  assignUuidIds,
  generateHourSessions,
  getMapAndSorted,
  parseScheduleJson,
  validateShiftTimes,
} from './utils';

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
  config: ConfigurationDto,
  client: PrismaClient,
) => {
  const db = await pool(schema).connect();
  await client.$executeRaw`select 1`;

  // Insert initial data into the database
  const { sedes, areas, shifts } = await createBasicData(db, config.shifts);

  // Insert monitors and classes into the database
  // const dataMonitors =
  const { classes } = await createDataMonitors(
    db,
    arrayMonitors(config, areas, shifts, sedes),
  );

  if (config.createSchedules) {
    // Get map of classes to areas and shifts
    const classMap = getMapAndSorted(classes, shifts, areas);
    // Generate schedules for each area and shift
    await createSchedules(db, config, classMap);
  }

  return 'data created';
};

/**
 * Create data users, monitors and classes
 */
const createDataMonitors = async (pool: PoolClient, data: DataMonitor[]) => {
  const tablesToInsert = [
    { table: 'users', data: data.map((d) => d.user) },
    { table: 'monitors', data: data.map((d) => d.monitor) },
    { table: 'classes', data: data.map((d) => d.classes) },
  ];

  const queries = tablesToInsert.map((t) =>
    createInsertQuery(
      t.table,
      extractColumnsSql(t.data as object[]),
      extractValuesSql(t.data as object[]),
    ),
  );

  console.log(concatQuery(queries));
  await pool.query('select 1');

  return {
    classes: data.map((d) => d.classes),
  };
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

    // Validate and assign IDs to shifts and generate hour sessions
    const shiftsWithIds = shiftsBody.map((shift) => validateShiftTimes(shift));
    const hoursSessionsWithIds = assignNumericIds(
      shiftsWithIds.flatMap((shift) => generateHourSessions(shift)),
    );

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
      { table: 'hour_sessions', data: hoursSessionsWithIds },
    ];

    // Crear consultas de inserción para cada tabla
    const queries = tablesToInsert.map((t) =>
      createInsertQuery(
        t.table,
        extractColumnsSql(t.data as object[]),
        extractValuesSql(t.data as object[]),
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
      courses: coursesWithIds,
      hourSessions: hoursSessionsWithIds,
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
    .map((col: string) => `"${toSnakeCase(col)}"`)
    .join(', ');
};
const toSnakeCase = (str: string): string => {
  return str.replace(/([A-Z])/g, '_$1').toLowerCase();
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

/**
 * Create Schedules in the database
 */
const createSchedules = async (
  pool: PoolClient,
  config: ConfigurationDto,
  classes: Record<string, Record<string, Class[]>>,
) => {
  const dataSchedules = {
    bio: parseScheduleJson('schedules/bio.json'),
    ing: parseScheduleJson('schedules/ing.json'),
    soc: parseScheduleJson('schedules/soc.json'),
  };

  return null;
};
