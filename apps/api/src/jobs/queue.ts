import { eq, sql } from 'drizzle-orm';
import { newId } from '@class-pulse/domain';
import type { Db } from '../db/client';
import { jobs } from '../db/schema';

export type JobType = 'generate_plan' | 'interpret_candidate' | 'narrate_review' | 'sweep_case' | 'sweep_all' | 'open_due_reviews';

export interface JobEnvelope {
  id: string;
  type: JobType;
  payload: Record<string, unknown>;
  attempts: number;
}

export type JobHandler = (job: JobEnvelope) => Promise<void>;

/**
 * Generation calls and the nightly sweep never run inside a request handler (docs/05
 * "Generation service"). One driver: a durable, Postgres-backed queue polled inside the API
 * process. Redis/BullMQ was dropped (docs/08) — one API instance is the deployment shape, and
 * a DB-backed queue survives restarts without a second service to run.
 */
export interface JobQueue {
  readonly driver: 'inprocess';
  enqueue(type: JobType, payload: Record<string, unknown>, opts?: { delayMs?: number; dedupeKey?: string }): Promise<string>;
  start(handler: JobHandler): Promise<void>;
  stop(): Promise<void>;
  /** Process everything currently due, synchronously. Used by tests and the seed script. */
  drain(): Promise<number>;
}

const MAX_ATTEMPTS = 3;

/**
 * How long a job may sit in 'running' before another worker treats it as abandoned and takes it
 * back. A claim refreshes `updated_at`, so this is effectively a lease with no heartbeat: it is
 * safe only while it stays well above the slowest job. Generation is seconds to tens of seconds
 * (docs/05), so fifteen minutes is a wide margin — but anything that could legitimately run
 * longer than this needs a heartbeat before it can be enqueued here.
 */
const STALE_AFTER_SECONDS = 15 * 60;

/** How often a poller looks for abandoned jobs. Cheap, but not worth doing on every 1s tick. */
const RECLAIM_EVERY_MS = 60_000;

interface ClaimedRow {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
}

export class InProcessQueue implements JobQueue {
  readonly driver = 'inprocess' as const;
  private handler: JobHandler | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastReclaimAt = 0;

  constructor(
    private readonly db: Db,
    private readonly pollMs = 1000,
  ) {}

  async enqueue(type: JobType, payload: Record<string, unknown>, opts: { delayMs?: number; dedupeKey?: string } = {}): Promise<string> {
    const id = opts.dedupeKey ? `${type}:${opts.dedupeKey}` : newId();
    const runAt = new Date(Date.now() + (opts.delayMs ?? 0));
    await this.db
      .insert(jobs)
      .values({ id, type, payload, runAt })
      .onConflictDoUpdate({ target: jobs.id, set: { payload, runAt, status: 'queued', attempts: 0, error: null, updatedAt: new Date() } });
    return id;
  }

  async start(handler: JobHandler): Promise<void> {
    this.handler = handler;
    // Take back whatever a previous process abandoned. This deliberately does NOT reset every
    // 'running' row: another live worker's in-flight jobs look identical, and resetting them
    // would re-queue work that is still being done.
    await this.reclaimAbandoned();
    const tick = async () => {
      if (this.running) return;
      this.running = true;
      try {
        await this.drain();
      } catch (err) {
        // A transient database error (connection reset, schema being migrated) must never take the
        // API process down; the next tick retries.
        console.error('[jobs] poll failed:', err instanceof Error ? err.message : err);
      } finally {
        this.running = false;
      }
    };
    this.timer = setInterval(() => void tick(), this.pollMs);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Take one due job and mark it running, atomically. The row is selected and updated in a
   * single statement, so two pollers cannot both come away with the same job: SKIP LOCKED means
   * the second one steps over the row the first has locked rather than blocking on it or, as a
   * separate SELECT-then-UPDATE would, duplicating the work. Duplicating it is expensive and
   * visible here — a second model call and a second draft for the same case.
   */
  private async claim(): Promise<ClaimedRow | null> {
    const res = await this.db.execute(sql`
      UPDATE working.jobs
         SET status = 'running', attempts = attempts + 1, updated_at = now()
       WHERE id = (
         SELECT id FROM working.jobs
          WHERE status = 'queued' AND run_at <= now()
          ORDER BY run_at ASC, created_at ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
       )
      RETURNING id, type, payload, attempts
    `);
    const [row] = (res as unknown as { rows: ClaimedRow[] }).rows;
    return row ?? null;
  }

  /** Re-queue jobs whose worker died holding them. See STALE_AFTER_SECONDS. */
  private async reclaimAbandoned(): Promise<void> {
    this.lastReclaimAt = Date.now();
    await this.db.execute(sql`
      UPDATE working.jobs
         SET status = CASE WHEN attempts >= ${MAX_ATTEMPTS} THEN 'failed' ELSE 'queued' END,
             error = COALESCE(error, 'worker stopped before finishing this job'),
             updated_at = now()
       WHERE status = 'running'
         AND updated_at < now() - (${STALE_AFTER_SECONDS} * interval '1 second')
    `);
  }

  async drain(): Promise<number> {
    if (!this.handler) return 0;
    if (Date.now() - this.lastReclaimAt > RECLAIM_EVERY_MS) await this.reclaimAbandoned();
    let processed = 0;
    for (;;) {
      const job = await this.claim();
      if (!job) break;
      try {
        await this.handler({ id: job.id, type: job.type as JobType, payload: job.payload, attempts: job.attempts });
        await this.db.update(jobs).set({ status: 'done', updatedAt: new Date() }).where(eq(jobs.id, job.id));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await this.db
          .update(jobs)
          .set({ status: job.attempts >= MAX_ATTEMPTS ? 'failed' : 'queued', error: message, runAt: new Date(Date.now() + 5_000 * job.attempts), updatedAt: new Date() })
          .where(eq(jobs.id, job.id));
      }
      processed++;
    }
    return processed;
  }
}

