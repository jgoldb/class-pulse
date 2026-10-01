import { z } from 'zod';
export const TomorrowSchedule = z.object({
  enabled: z.boolean(), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  classWeekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  closureDates: z.array(z.iso.date()).max(370),
}).strict();
export type TomorrowSchedule = z.infer<typeof TomorrowSchedule>;
export function schoolClock(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const p = (key: string) => parts.find((s) => s.type === key)!.value;
  return { date: `${p('year')}-${p('month')}-${p('day')}`, time: `${p('hour')}:${p('minute')}` };
}
export function nextClassDate(after: string, schedule: Pick<TomorrowSchedule, 'classWeekdays' | 'closureDates'>) {
  const date = new Date(`${after}T12:00:00Z`);
  for (let i = 0; i < 370; i++) {
    date.setUTCDate(date.getUTCDate() + 1);
    const key = date.toISOString().slice(0, 10);
    if (schedule.classWeekdays.includes(date.getUTCDay()) && !schedule.closureDates.includes(key)) return key;
  }
  return null;
}
/** Spring gaps run at the first later minute; fall repeats are deduplicated by local date. */
export function scheduleDue(now: Date, timezone: string, schedule: TomorrowSchedule, lastPreparedDate: string | null) {
  const local = schoolClock(now, timezone);
  const weekday = new Date(`${local.date}T12:00:00Z`).getUTCDay();
  if (!schedule.enabled || local.date === lastPreparedDate || local.time < schedule.time || !schedule.classWeekdays.includes(weekday) || schedule.closureDates.includes(local.date)) return null;
  const targetDate = nextClassDate(local.date, schedule);
  return targetDate ? { preparedDate: local.date, targetDate } : null;
}
