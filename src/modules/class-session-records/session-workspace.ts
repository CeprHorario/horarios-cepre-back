import type { ClassSessionRecord, Prisma } from '../../generated/prisma/client';

// Raw SQL projects only base facts. Convert column names, never snapshot/observation keys.
export function workspaceColumns<T>(value: Record<string, unknown>): T {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()),
      item,
    ]),
  ) as T;
}

export interface WorkspaceCapture {
  fileId: string;
  generation: string | null;
  status: string;
}
export interface WorkspaceRow extends ClassSessionRecord {
  teacherCoverage: Record<string, Prisma.JsonValue> | null;
  monitorCoverage: Record<string, Prisma.JsonValue> | null;
  currentReview: Record<string, Prisma.JsonValue> | null;
  initialCapture: WorkspaceCapture | null;
  finalCapture: WorkspaceCapture | null;
}
