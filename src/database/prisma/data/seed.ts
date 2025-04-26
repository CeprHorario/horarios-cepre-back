import { PrismaClient, User } from '@prisma/client';
import { Pool, PoolClient } from 'pg';

//import * as dataInitial from './initial.json';
//import * as courses from './courses.json';
//import * as areaCourseHr from './area-course-hrs.json';
//import * as schedulesBio from './data/bio.json';
//import * as schedulesIng from './data/ing.json';
//import * as schedulesSoc from './data/soc.json';
//import * as schema from '@database/drizzle/schema';
//import { dataCorreos } from './utils';
import { ProcessAdmissionDto } from '@modules/admissions/dto/create-admission.dto';
import { Area, Sede, ShiftTimes } from './type';

type DataUsersClass = {
  sede: Sede;
  area: Area
  shift: ShiftTimes;
  users: User[];
  monitors: string[];
};

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
  console.log(db);
  console.log(body);
};

const createUsersClass = async (pool: PoolClient, data: DataUsersClass[]) => {
  
}

const generateInsertQuery = (
  table: string,
  columns: string[],
  values: Record<string, any>[],
): string => {
  // Formatear el nombre de las columnas
  const columnsSQL = columns.map((col: string) => `"${col}"`).join(', ');
  
  // Construir los valores con formato adecuado según el tipo de dato
  const valueStrings = values
    .map(
      (row: Record<string, any>) =>
      '(' +
      columns
          .map((col: string) => {
            const value = row[col];
            // Manejo de diferentes tipos de datos
            if (value === null || value === undefined) {
              return 'NULL';
            } else if (typeof value === 'number') {
              return value.toString();
            } else if (typeof value === 'boolean') {
              return value ? 'TRUE' : 'FALSE';
            } else if (value instanceof Date) {
              return `'${value.toISOString()}'`;
            } else {
              // Para strings, escapar comillas simples
              return `'${String(value).replace(/'/g, "''")}'`;
            }
          })
        .join(', ') +
      ')'
    )
    .join(',\n');
  
  return `INSERT INTO "${table}" (${columnsSQL}) VALUES\n${valueStrings};`;
};
