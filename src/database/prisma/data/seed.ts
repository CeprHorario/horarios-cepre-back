import { PrismaClient } from '@prisma/client';
import { Pool, PoolClient } from 'pg';

import * as dataInitial from './initial.json';
import * as dataCourses from './courses.json';
//import * as areaCourseHr from './area-course-hrs.json';
//import * as schedulesBio from './data/bio.json';
//import * as schedulesIng from './data/ing.json';
//import * as schedulesSoc from './data/soc.json';
//import * as schema from '@database/drizzle/schema';
//import { dataCorreos } from './utils';
import { ProcessAdmissionDto } from '@modules/admissions/dto/create-admission.dto';
import { Course, DataInitial } from './type';
import { assignNumericIds, assignUuidIds } from './utils';

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

  if (await createBasicData(db)) {
    console.log(body);
  } else {
    throw new Error('Error creating data');
  }
};

const createBasicData = async (pool: PoolClient): Promise<boolean> => {
  const { users, areas, sedes } = dataInitial as DataInitial;
  const courses = dataCourses as Course[];

  try {
    // asingIds(users, areas, sedes, courses);
    assignUuidIds(users);
    assignNumericIds(areas);
    assignNumericIds(sedes);
    assignNumericIds(courses);

    // Crear consultas para todas las tablas de una forma más concisa
    const tablesToInsert = [
      { table: 'users', data: users },
      { table: 'areas', data: areas },
      { table: 'sedes', data: sedes },
      { table: 'courses', data: courses },
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
    await pool.query(concatQuery(queries));
    return true;
  } catch (error) {
    console.error('Error creating basic data:', error);
    return false;
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
