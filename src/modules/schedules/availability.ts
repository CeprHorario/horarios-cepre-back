export interface TimeInterval {
  weekday: string;
  startMinute: number;
  endMinute: number;
}

export function overlaps(a: TimeInterval, b: TimeInterval): boolean {
  return (
    a.weekday === b.weekday &&
    a.startMinute < b.endMinute &&
    b.startMinute < a.endMinute
  );
}

export function covers(
  intervals: TimeInterval[],
  target: TimeInterval,
): boolean {
  let cursor = target.startMinute;
  for (const item of intervals
    .filter((i) => i.weekday === target.weekday)
    .sort((a, b) => a.startMinute - b.startMinute)) {
    if (item.startMinute > cursor) break;
    if (item.endMinute > cursor) cursor = item.endMinute;
    if (cursor >= target.endMinute) return true;
  }
  return false;
}

export function normalizeIntervals<T extends TimeInterval>(
  intervals: T[],
): T[] {
  const result: T[] = [];
  for (const item of [...intervals].sort(
    (a, b) =>
      a.weekday.localeCompare(b.weekday) || a.startMinute - b.startMinute,
  )) {
    const previous = result.at(-1);
    if (
      previous &&
      previous.weekday === item.weekday &&
      item.startMinute <= previous.endMinute
    ) {
      previous.endMinute = Math.max(previous.endMinute, item.endMinute);
    } else result.push({ ...item });
  }
  return result;
}

export function scheduleInterval(schedule: {
  weekday: string;
  hourSession: { startTime: Date; endTime: Date };
}): TimeInterval {
  const minute = (date: Date) => date.getUTCHours() * 60 + date.getUTCMinutes();
  return {
    weekday: schedule.weekday,
    startMinute: minute(schedule.hourSession.startTime),
    endMinute: minute(schedule.hourSession.endTime),
  };
}
