process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://test:test@127.0.0.1:1/cepr_test';
process.env.REDIRECT_FRONT = 'http://localhost:5173';
process.env.DB_POOL_MAX = '2';
process.env.JWT_SECRET = 'test-secret-only-with-at-least-32-bytes';
process.env.GOOGLE_CLIENT_ID = 'test-client';
process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
process.env.GOOGLE_REDIRECT_URI =
  'http://localhost:8080/api/auth/google/redirect';
