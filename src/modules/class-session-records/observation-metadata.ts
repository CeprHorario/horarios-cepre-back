import { isDeepStrictEqual } from 'node:util';
import type { PartObservationDto } from '../operations/operations.dto';
import type { SessionActor } from './session.types';

export function observationMetadata(
  entries: PartObservationDto[],
  previous: unknown,
  actor: SessionActor,
  now: Date,
) {
  const old = Array.isArray(previous)
    ? previous.filter(
        (note): note is Record<string, unknown> =>
          !!note && typeof note === 'object' && !Array.isArray(note),
      )
    : [];
  return entries
    .map((entry): Record<string, unknown> => {
      const value = {
        id: entry.id,
        target: entry.target,
        description: entry.description.trim(),
        ...(entry.target === 'STUDENT'
          ? {
              firstName: entry.firstName!.trim(),
              lastName: entry.lastName!.trim(),
            }
          : {}),
      };
      const existing = old.find((note) => note.id === entry.id);
      if (!existing)
        return {
          ...value,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          author: { ...actor },
          updatedBy: { ...actor },
        };
      const content = Object.fromEntries(
        Object.keys(value).map((key) => [key, existing[key]]),
      );
      if (isDeepStrictEqual(value, content)) return existing;
      // Legacy notes keep unknown creation time/author. The time of this edit is known.
      return {
        ...value,
        createdAt: existing.createdAt ?? null,
        author: existing.author ?? null,
        updatedAt: now.toISOString(),
        updatedBy: { ...actor },
      };
    })
    .sort((a, b) => {
      const instant = (note: Record<string, unknown>) =>
        typeof note.createdAt === 'string'
          ? Date.parse(note.createdAt) || 0
          : 0;
      return (
        instant(b) - instant(a) || String(a.id).localeCompare(String(b.id))
      );
    });
}
