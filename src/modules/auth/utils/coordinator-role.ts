export interface CoordinatorRoleScope {
  isCoordinator: boolean;
  courseId?: number;
}

export const COORDINATOR_ROLE = 'coordinador';

export function parseCoordinatorRole(role?: string): CoordinatorRoleScope {
  if (!role) return { isCoordinator: false };
  if (role === COORDINATOR_ROLE) return { isCoordinator: true };

  const match = role.match(/^coordinador-(\d+)$/);
  if (!match) return { isCoordinator: false };

  return {
    isCoordinator: true,
    courseId: Number(match[1]),
  };
}

export function getCoordinatorCourseId(role?: string): number | undefined {
  return parseCoordinatorRole(role).courseId;
}
