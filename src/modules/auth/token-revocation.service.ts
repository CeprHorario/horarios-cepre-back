import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { and, eq, gt, lt } from 'drizzle-orm';
import { DrizzleService } from '@database/drizzle/drizzle.service';
import { revokedTokens } from '@database/drizzle/schema';

@Injectable()
export class TokenRevocationService {
  constructor(private readonly drizzle: DrizzleService) {}
  private hash(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
  async assertActive(token: string) {
    const revoked = await this.drizzle.db
      .select({ hash: revokedTokens.tokenHash })
      .from(revokedTokens)
      .where(
        and(
          eq(revokedTokens.tokenHash, this.hash(token)),
          gt(revokedTokens.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (revoked.length) throw new UnauthorizedException();
  }
  async revoke(token: string, expiresAt: number) {
    await this.drizzle.db.transaction(async (tx) => {
      await tx
        .insert(revokedTokens)
        .values({
          tokenHash: this.hash(token),
          expiresAt: new Date(expiresAt * 1000),
        })
        .onConflictDoNothing();
      await tx
        .delete(revokedTokens)
        .where(lt(revokedTokens.expiresAt, new Date()));
    });
  }
}
