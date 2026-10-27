import { ForbiddenException } from '@nestjs/common';
import type { PrismaClient } from '../../generated/prisma/client';

export interface ResourceActor {
  userId: string;
  role: string;
}

export async function assertMonitorAccess(
  client: PrismaClient,
  userId: string,
  actor: ResourceActor,
) {
  if (actor.role === 'administrador') return;
  const allowed =
    actor.role === 'monitor'
      ? { userId: actor.userId }
      : actor.role === 'supervisor'
        ? { supervisors: { userId: actor.userId } }
        : null;
  if (
    !allowed ||
    !(await client.monitor.findFirst({
      where: { AND: [{ userId }, allowed] },
      select: { id: true },
    }))
  )
    throw new ForbiddenException('Recurso no autorizado');
}

export async function assertSupervisorAccess(
  client: PrismaClient,
  id: string,
  actor: ResourceActor,
) {
  if (actor.role === 'administrador') return;
  if (
    actor.role !== 'supervisor' ||
    !(await client.supervisor.findFirst({
      where: { id, userId: actor.userId },
      select: { id: true },
    }))
  )
    throw new ForbiddenException('Recurso no autorizado');
}
