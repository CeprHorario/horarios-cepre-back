import { Class } from '@prisma/client';
import { Pool, PoolClient } from 'pg';

import * as rawData from './initial.json';
import * as rawCourses from './courses.json';
import * as areaCourseHr from './area-course-hrs.json';
import * as rawScheduleBio from './schedules/bio.json';
import * as rawScheduleIng from './schedules/ing.json';
import * as rawScheduleSoc from './schedules/soc.json';

import * as fs from 'fs/promises';
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
  HourSessionData,
  ScheduleData,
} from './type';
import {
  arrayMonitors,
  assignNumericIds,
  assignUuidIds,
  generateHourSessions,
  generateScheduleData,
  getMapAndSorted,
  parsedScheduleJson,
  validateShiftTimes,
} from './utils';

const pool = (schema: string): Pool => {
  return new Pool({
    connectionString: `${process.env.DATABASE_URL}`,
    options: `-c search_path=${schema}`,
  });
};

export const initialDataSchema = async (
  schema: string,
  config: ConfigurationDto,
): Promise<boolean> => {
  const db = await pool(schema).connect();
  // Start a transaction
  await db.query('BEGIN');

  try {
    // Create data in schema new
    const sql = await fs.readFile(
      './src/database/drizzle/sql/schema.sql',
      'utf8',
    );
    await db.query(sql);

    // 1: Create the basic data in the database
    const { areas, shifts, sedes, hourSessions, courses } =
      await createBasicData(db, config.shifts);

    // 2: Insert monitors and classes into the database
    const { classes } = await createDataMonitors(
      db,
      arrayMonitors(config, areas, shifts, sedes),
    );

    // 3: Create the schedules in the database
    if (config.createSchedules) {
      // Get map of classes to areas and shifts
      const classMap = getMapAndSorted(classes, shifts, areas);

      // Generate schedules for each area and shift
      console.log('Schedules created*********************************');
      await createSchedules(db, config.shifts, classMap, hourSessions, courses);
    }

    // Transaction commit
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    console.log('***ROLLBACK***');
    throw new Error(error as string);
  } finally {
    db.release();
  }

  return true;
};

/** 1-
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
      const courseId = coursesWithIds.find((c) => c.name === course.course)?.id;
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

  // Concatenate all queries into a single string
  await pool.query(concatQuery(queries));
  return {
    sedes: sedesWithIds,
    areas: areasWithIds,
    shifts: shiftsWithIds,
    courses: coursesWithIds,
    hourSessions: hoursSessionsWithIds,
  };
};

/** 2-
 * Create data users, monitors and classes
 */
export const createDataMonitors = async (
  pool: PoolClient,
  data: DataMonitor[],
) => {
  // Destructure the data from the JSON files
  const tablesToInsert = [
    { table: 'users', data: data.map((d) => d.user) },
    { table: 'monitors', data: data.map((d) => d.monitor) },
    { table: 'classes', data: data.map((d) => d.classes) },
  ];

  // Create insert queries for each table
  const queries = tablesToInsert.map((t) =>
    createInsertQuery(
      t.table,
      extractColumnsSql(t.data as object[]),
      extractValuesSql(t.data as object[]),
    ),
  );

  // Concatenate all queries into a single string
  await pool.query(concatQuery(queries));
  return {
    classes: data.map((d) => d.classes),
  };
};

/** 3-
 * Create Schedules in the database
 */
export const createSchedules = async (
  pool: PoolClient,
  shifts: ShiftDetailDto[],
  classes: Record<string, Record<string, Class[]>>,
  hourSessions: HourSessionData[],
  courses: Course[],
) => {
  const dataSchedules = {
    bio: parsedScheduleJson(rawScheduleBio as any),
    ing: parsedScheduleJson(rawScheduleIng as any),
    soc: parsedScheduleJson(rawScheduleSoc as any),
  };
  const areas: string[] = [];
  shifts.map((s) => {
    s.classesToAreas.map((c) => {
      /*   'Biomédicas': {
          'Turno 1': [
            [Object], [Object],
          ]
        }
      } */
      if (c.quantityClasses !== classes[c.area][s.name].length) {
        throw new Error(
          `Error: The number of classes for area ${c.area} in shift ${s.name} does not match the number of classes in the database.`,
        );
      }
      if (!areas.includes(c.area)) areas.push(c.area);
    });
  });

  const scheduleData: ScheduleData[] = [];
  // Corrigelo para usar courses los campos que tiene son name y id
  const courseMap = new Map(courses.map((c) => [c.name, c.id ?? 0]));

  // Process the schedules for each area
  if (areas.includes('Biomédicas')) {
    console.log('areas', areas);
    scheduleData.push(
      ...generateScheduleData(
        dataSchedules.bio,
        classes['Biomédicas'],
        courseMap,
        hourSessions,
      ),
    );
  }

  if (areas.includes('Ingenierías')) {
    scheduleData.push(
      ...generateScheduleData(
        dataSchedules.ing,
        classes['Ingenierías'],
        courseMap,
        hourSessions,
      ),
    );
  }

  if (areas.includes('Sociales')) {
    scheduleData.push(
      ...generateScheduleData(
        dataSchedules.soc,
        classes['Sociales'],
        courseMap,
        hourSessions,
      ),
    );
  }

  // Process scheduleData in chunks of 5000 records to avoid memory issues
  const chunkSize = 3000;
  const chunks = Array.from(
    { length: Math.ceil(scheduleData.length / chunkSize) },
    (_, i) => scheduleData.slice(i * chunkSize, (i + 1) * chunkSize),
  );

  // Insert each chunk into the database
  await Promise.all(
    chunks.map((chunk) =>
      pool.query(
        createInsertQuery(
          'schedules',
          extractColumnsSql(chunk),
          extractValuesSql(chunk),
        ),
      ),
    ),
  );

  // Insert the schedule data into the database
  await pool.query('select 1');
  return null;
};

/**
 * METODOS DE AYUDA
 */

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
