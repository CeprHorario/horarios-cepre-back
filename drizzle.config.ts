import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: 'src/database/drizzle/schema.ts',
  out: 'src/database/drizzle/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  migrations: {
    table: '__drizzle_migrations',
    schema: 'public',
  },
});
