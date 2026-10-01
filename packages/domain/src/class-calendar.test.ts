import { describe, expect, it } from 'vitest';
import { nextClassDate, scheduleDue } from './class-calendar';
const weekdays = { enabled: true, time: '15:30', classWeekdays: [1, 2, 3, 4, 5], closureDates: ['2026-10-12'] };
describe('school calendar', () => {
  it('skips weekends and closures', () => expect(nextClassDate('2026-10-09', weekdays)).toBe('2026-10-13'));
  it('uses school timezone and waits for the configured minute', () => {
    expect(scheduleDue(new Date('2026-09-30T19:29:00Z'), 'America/New_York', weekdays, null)).toBeNull();
    expect(scheduleDue(new Date('2026-09-30T19:30:00Z'), 'America/New_York', weekdays, null)?.targetDate).toBe('2026-10-01');
  });
  it('handles spring gaps and fall repeated hours once per local day', () => {
    const allDays = { ...weekdays, classWeekdays: [0, 1, 2, 3, 4, 5, 6], time: '02:30' };
    expect(scheduleDue(new Date('2026-03-08T07:00:00Z'), 'America/New_York', allDays, null)?.preparedDate).toBe('2026-03-08');
    const fall = { ...allDays, time: '01:30' };
    expect(scheduleDue(new Date('2026-11-01T05:30:00Z'), 'America/New_York', fall, null)?.preparedDate).toBe('2026-11-01');
    expect(scheduleDue(new Date('2026-11-01T06:30:00Z'), 'America/New_York', fall, '2026-11-01')).toBeNull();
  });
  it('stays quiet when disabled or closed', () => {
    expect(scheduleDue(new Date('2026-10-12T22:00:00Z'), 'America/New_York', weekdays, null)).toBeNull();
    expect(scheduleDue(new Date('2026-09-30T22:00:00Z'), 'America/New_York', { ...weekdays, enabled: false }, null)).toBeNull();
  });
});
