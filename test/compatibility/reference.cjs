// Run from a disposable copy of bck-v0 with its own locked dependencies.
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { Test } = require('@nestjs/testing');
const { ValidationPipe } = require('@nestjs/common');
const { AppModule } = require('./src/app/app.module');
const { RuntimeConfigService } = require('./src/modules/runtime-config/runtime-config.service');
const fs = require('node:fs');
const { PrismaClientFactory } = require('./src/database/prisma/prisma-client.factory');
const { Prisma } = require('@prisma/client');
const originalClient = PrismaClientFactory.prototype.getClient;
const traced = new WeakSet();
PrismaClientFactory.prototype.getClient = function (...args) {
  const client = originalClient.apply(this, args);
  if (!traced.has(client)) {
    traced.add(client);
    client.$use(async (params, next) => {
      try { return await next(params); }
      catch (error) {
        console.error('REFERENCE_DB_ERROR', params.model, params.action, error.code, error.meta, error instanceof Prisma.PrismaClientKnownRequestError, error.message);
        throw error;
      }
    });
  }
  return client;
};

async function main() {
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RuntimeConfigService)
    .useValue({ getCurrent: async () => JSON.parse(fs.readFileSync(process.env.TEST_RUNTIME_FILE, 'utf8')) })
    .compile();
  const app = module.createNestApplication({ logger: ['error', 'warn'] });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(Number(process.env.PORT), '0.0.0.0');
  console.log('REFERENCE_READY');
  process.on('SIGTERM', async () => { await app.close(); process.exit(0); });
}
main().catch((error) => { console.error(error); process.exit(1); });
