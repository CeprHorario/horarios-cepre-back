import { NotFoundException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { DeactivateManyResultDto } from './dto/deactivate-many.dto';

type Tx = Prisma.TransactionClient;

/**
 * Eliminación lógica en bloque: resuelve los usuarios de los ids recibidos y los marca inactivos
 * en una sola transacción. Si algún id no existe no se modifica nada.
 */
export async function deactivateUsers(
  client: PrismaClient,
  ids: string[],
  resolveUserIds: (tx: Tx, ids: string[]) => Promise<string[]>,
  label: string,
): Promise<DeactivateManyResultDto> {
  const unique = [...new Set(ids)];
  return client.$transaction(async (tx) => {
    const userIds = await resolveUserIds(tx, unique);
    if (userIds.length !== unique.length) {
      throw new NotFoundException(
        `${unique.length - userIds.length} de ${unique.length} ${label} no existen; no se eliminó ninguno`,
      );
    }
    const { count } = await tx.user.updateMany({
      where: { id: { in: userIds } },
      data: { isActive: false },
    });
    return { deactivated: count };
  });
}
