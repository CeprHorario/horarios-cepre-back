import { observationMetadata } from './observation-metadata';
import { Role } from '../auth/decorators/authorization.decorator';
const actor = {
  id: 'actor',
  email: 'monitor@test.invalid',
  schema: 'academic',
  origin: 'academic',
  role: Role.MONITOR,
};
describe('Metadata de observaciones de clase', () => {
  it('no inventa creación ni autor para una nota heredada modificada', () => {
    const previous = [
      {
        id: 'note',
        target: 'CLASSROOM' as const,
        description: 'Descripción antigua',
      },
    ];
    const now = new Date('2026-11-03T15:00:00Z');
    expect(
      observationMetadata(
        [
          {
            id: 'note',
            target: 'CLASSROOM',
            description: 'Descripción corregida',
          },
        ],
        previous,
        actor,
        now,
      ),
    ).toEqual([
      {
        id: 'note',
        target: 'CLASSROOM',
        description: 'Descripción corregida',
        createdAt: null,
        author: null,
        updatedAt: now.toISOString(),
        updatedBy: actor,
      },
    ]);
  });
  it('una nota intacta conserva exactamente su metadata y no adquiere hora por reenviarse', () => {
    const previous = [
      {
        id: 'note',
        target: 'CLASSROOM' as const,
        description: 'Descripción antigua',
      },
    ];
    expect(observationMetadata(previous, previous, actor, new Date())).toEqual(
      previous,
    );
  });
});
