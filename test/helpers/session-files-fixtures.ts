import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { Client, Pool } from 'pg';
import { PrismaClient } from '../../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { applyStructure } from '../../src/database/prisma/structure';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../src/database/prisma/prisma.service';
import { RequestContext } from '../../src/database/schema-manager/request-context';
import { SessionPrincipal } from '../../src/modules/class-session-records/session.types';

export function pngFixture(
  width = 1,
  height = 1,
  color = 6,
  bitDepth = 8,
): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let i = 0; i < 8; i++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const size = Buffer.alloc(4),
      checksum = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, body, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = bitDepth;
  header[9] = color;
  const channels =
    ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[color] ?? 1;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc((width * channels + 1) * height))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function uploadFixture(
  overrides: Partial<Express.Multer.File> = {},
): Express.Multer.File {
  const buffer = pngFixture();
  return {
    buffer,
    size: buffer.length,
    originalname: 'captura.png',
    mimetype: 'image/png',
    ...overrides,
  } as Express.Multer.File;
}

export class SessionFilesFixture {
  readonly prefix = `sr_${randomUUID().replace(/-/g, '')}`;
  readonly schema = `${this.prefix}_a`;
  readonly otherSchema = `${this.prefix}_b`;
  readonly coreSchema = `${this.prefix}_core`;
  readonly clients = new Map<string, PrismaClient>();
  private readonly pools: Pool[] = [];
  readonly principals: Record<string, SessionPrincipal> = {};
  readonly supervisorId = randomUUID();
  readonly classId = randomUUID();
  readonly pg = new Client({ connectionString: process.env.DATABASE_URL });
  readonly context = new RequestContext();
  readonly prisma = new PrismaService(
    new ConfigService({
      DATABASE_URL: process.env.DATABASE_URL,
      DB_POOL_MAX: 4,
    }),
    this.context,
  );
  readonly apiPrisma = {
    getClientForSchema: (schema: string) =>
      this.prisma.getClientForSchema(
        schema === 'core_schema' ? this.coreSchema : schema,
      ),
    getClient: () => this.prisma.getClient(),
  };
  private created: string[] = [];

  client(schema = this.schema) {
    let client = this.clients.get(schema);
    if (!client) {
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        options: `-c search_path=${schema}`,
        max: 2,
      });
      this.pools.push(pool);
      client = new PrismaClient({
        adapter: new PrismaPg(pool, { schema, disposeExternalPool: false }),
      });
      this.clients.set(schema, client);
    }
    return client;
  }

  async initialize() {
    await this.pg.connect();
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const connection = await pool.connect();
    try {
      for (const schema of [this.schema, this.otherSchema, this.coreSchema]) {
        await connection.query('BEGIN');
        try {
          await applyStructure(connection, schema, true);
          await connection.query('COMMIT');
          this.created.push(schema);
        } catch (error) {
          await connection.query('ROLLBACK');
          throw error;
        }
      }
    } finally {
      connection.release();
      await pool.end();
    }
    for (const [name, role] of Object.entries({
      monitor: 'monitor',
      otherMonitor: 'monitor',
      supervisor: 'supervisor',
      otherSupervisor: 'supervisor',
      teacher: 'profesor',
      coordinator: 'coordinador',
      admin: 'administrador',
    })) {
      const principal = {
        userId: randomUUID(),
        email: `${name}@test.invalid`,
        role,
      };
      this.principals[name] = principal;
      await this.client(
        name === 'admin' ? this.coreSchema : this.schema,
      ).user.create({
        data: { id: principal.userId, email: principal.email, role },
      });
    }
    const db = this.client();
    await db.$executeRaw`INSERT INTO areas(id,name) VALUES (1,'Area')`;
    await db.$executeRaw`INSERT INTO courses(id,name) VALUES (1,'Course')`;
    await db.$executeRaw`INSERT INTO sedes(id,name) VALUES (1,'Sede')`;
    await db.$executeRaw`INSERT INTO shifts(id,name) VALUES (1,'Shift')`;
    await db.$executeRaw`INSERT INTO hour_sessions(id,shift_id,period,start_time,end_time) VALUES (1,1,1,'08:00','08:40')`;
    await db.$queryRaw`SELECT setval(pg_get_serial_sequence('hour_sessions','id'),1)`;
    await db.$executeRaw`INSERT INTO supervisors(id,user_id) VALUES (${this.supervisorId}::uuid,${this.principals.supervisor.userId}::uuid), (${randomUUID()}::uuid,${this.principals.otherSupervisor.userId}::uuid)`;
    await db.$executeRaw`INSERT INTO classes(id,name,id_sede,area_id,shift_id) VALUES (${this.classId}::uuid,'Class',1,1,1)`;
    // The same account and file/record IDs may legitimately exist in another process.
    await this.client(this.otherSchema).user.create({
      data: {
        id: this.principals.monitor.userId,
        email: this.principals.monitor.email,
        role: 'monitor',
      },
    });
  }

  async record() {
    const count = await this.client().classSessionRecord.count();
    const now = Date.now();
    return this.client().classSessionRecord.create({
      data: {
        date: new Date(Date.UTC(2026, 0, count + 1)),
        classId: this.classId,
        hourSessionId: 1,
        shiftId: 1,
        areaId: 1,
        courseId: 1,
        scheduledStart: new Date(now - 3600_000),
        scheduledEnd: new Date(now - 1800_000),
        shiftEnd: new Date(now - 1800_000),
        editDeadline: new Date(now - 1800_000 + 90 * 60_000),
        period: 1,
        pedagogicalMinutes: 40,
        monitorAccountId: this.principals.monitor.userId,
        supervisorId: this.supervisorId,
        snapshot: {},
        timingPolicy: {},
      },
    });
  }

  async closeRecord(id: number) {
    await this.client()
      .$executeRaw`UPDATE class_session_records SET scheduled_start=CURRENT_TIMESTAMP-interval '3 hours', scheduled_end=CURRENT_TIMESTAMP-interval '2 hours', shift_end=CURRENT_TIMESTAMP-interval '2 hours', edit_deadline=CURRENT_TIMESTAMP-interval '30 minutes' WHERE id=${id}`;
  }

  async close() {
    await this.prisma.onModuleDestroy();
    await Promise.all(
      [...this.clients.values()].map((client) => client.$disconnect()),
    );
    await Promise.all(this.pools.map((pool) => pool.end()));
    // Only random schemas created by this fixture; never public or existing data.
    for (const schema of this.created.reverse())
      await this.pg.query(`DROP SCHEMA "${schema}" CASCADE`);
    await this.pg.end();
  }
}
