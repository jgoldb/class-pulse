import type { AppContext } from '../context';

// Minimal cron for the two scheduled jobs (docs/05): nightly pattern sweep and opening due
// review cycles. Supports the standard 5-field form with numbers, wildcards, ranges and step
// values (asterisk-slash-n) — enough for "0 2 * * *" without a dependency.
function field(spec: string, value: number, max: number): boolean {
  return spec.split(',').some((part) => {
    if (part === '*') return true;
    const step = part.match(/^\*\/(\d+)$/);
    if (step) return value % Number(step[1]) === 0;
    const range = part.match(/^(\d+)-(\d+)$/);
    if (range) return value >= Number(range[1]) && value <= Number(range[2]);
    return Number(part) === value % (max + 1);
  });
}

export function cronMatches(expr: string, d: Date): boolean {
  const [m, h, dom, mon, dow] = expr.trim().split(/\s+/);
  if (!m || !h || !dom || !mon || !dow) return false;
  return field(m, d.getMinutes(), 59) && field(h, d.getHours(), 23) && field(dom, d.getDate(), 31) && field(mon, d.getMonth() + 1, 12) && field(dow, d.getDay(), 6);
}

export function startScheduler(ctx: AppContext): () => void {
  let lastMinute = -1;
  const tick = async () => {
    const now = ctx.now();
    const minute = Math.floor(now.getTime() / 60_000);
    if (minute === lastMinute) return;
    lastMinute = minute;
    if (cronMatches(ctx.config.jobs.sweepCron, now)) {
      await ctx.queue.enqueue('sweep_all', {}, { dedupeKey: `nightly-${now.toISOString().slice(0, 10)}` });
    }
    // Review cycles are checked hourly; opening one is idempotent.
    if (now.getMinutes() === 5) await ctx.queue.enqueue('open_due_reviews', {}, { dedupeKey: `reviews-${now.toISOString().slice(0, 13)}` });
  };
  const timer = setInterval(() => void tick().catch((err) => ctx.log.error(err, 'scheduler tick failed')), 30_000);
  timer.unref?.();
  return () => clearInterval(timer);
}
