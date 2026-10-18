import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

describe('Configuración HTTP', () => {
  let app: INestApplication<Server>;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('expone solamente el health inicial bajo /api', async () => {
    await request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect({ status: 'ok' });
    await request(app.getHttpServer()).get('/health').expect(404);
  });

  it('publica OpenAPI con el prefijo correcto y soporte Bearer', async () => {
    const response = await request(app.getHttpServer())
      .get('/swagger/json')
      .expect(200);
    const document = response.body as {
      paths: Record<string, unknown>;
      components: { securitySchemes: Record<string, unknown> };
    };
    expect(document.paths).toHaveProperty('/api/health');
    expect(document.paths).toHaveProperty('/api/system/runtime-config');
    expect(document.components.securitySchemes).toHaveProperty('bearer');
  });

  it('mantiene el origen CORS y la cabecera Authorization', async () => {
    await request(app.getHttpServer())
      .options('/api/health')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'Authorization')
      .expect(204)
      .expect('Access-Control-Allow-Origin', 'http://localhost:5173')
      .expect('Access-Control-Allow-Credentials', 'true')
      .expect('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  });
});
