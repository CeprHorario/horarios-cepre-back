export default () => ({
  PORT: Number(process.env.PORT) || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  DATABASE_URL: process.env.DATABASE_URL || '',
  CORE_SCHEMA: process.env.CORE_SCHEMA || 'core_schema',
  GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT || '',
  FIRESTORE_DATABASE_ID: process.env.FIRESTORE_DATABASE_ID || '(default)',
  RUNTIME_CONFIG_CACHE_TTL_MS:
    Number(process.env.RUNTIME_CONFIG_CACHE_TTL_MS) || 15000,
  CACHE_KEYS: {
    ALL_ADMISSIONS: 'all_admissions',
    CURRENT_ADMISSION: 'current_admission',
  },
  REDIRECT_FRONT: process.env.REDIRECT_FRONT || 'http://localhost:5173/',
});
