import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  out: 'src/database/drizzle/migrations', // ubicación de las migraciones
  schema: 'src/database/drizzle/schema.ts', // ubicación del esquema de la base de datos
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL as string, //usar cuando se despliegue en google cloud
    /*host: process.env.DB_HOST as string,
    port: parseInt(process.env.DB_PORT as string, 10),
    user: process.env.DB_USER as string,
    password: process.env.DB_PASSWORD as string,
    database: process.env.DB_DATABASE as string,*/
    //ssl: {
    //  rejectUnauthorized: false,
    //},
  },
  migrations: {
    table: '__drizzle_migrations', // `__drizzle_migrations` by default
    schema: 'public', // used in PostgreSQL only, `drizzle` by default
  },
});
