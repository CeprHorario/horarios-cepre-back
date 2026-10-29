import { Prisma, PrismaClient } from '../../generated/prisma/client';
import { Role } from '@modules/auth/decorators/authorization.decorator';

export interface SessionPrincipal {
  userId: string;
  email: string;
  role: string;
}
export interface SessionActor {
  id: string;
  origin: string;
  email: string;
  role: Role | 'system';
  schema: string;
}
export type SessionTx = Prisma.TransactionClient;
export interface RecordContext {
  client: PrismaClient;
  schema: string;
  actor: SessionActor;
}
export const systemActor = (schema: string): SessionActor => ({
  id: 'system:class-session-records',
  origin: 'system',
  email: '',
  role: 'system',
  schema,
});
export function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
