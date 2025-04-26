import { PrismaClient } from '@prisma/client';

//import * as dataInitial from './initial.json';
//import * as courses from './courses.json';
//import * as areaCourseHr from './area-course-hrs.json';
//import * as schedulesBio from './data/bio.json';
//import * as schedulesIng from './data/ing.json';
//import * as schedulesSoc from './data/soc.json';

export const initialDataSchema = async (
  schema: string,
  client: PrismaClient,
) => {
  await client.$executeRaw`select 1`;
  return 'create schema if not exists ' + schema;
};
