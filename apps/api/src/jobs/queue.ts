import { and, asc, eq, lte, sql } from 'drizzle-orm';
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
 * "Generation service"). Two drivers behind one interface:
 *  - inprocess: a durable, DB-backed queue polled inside the API process (default; no Redis)
 *  - bullmq:    BullMQ over Redis for multi-process deployments (JOB_DRIVER=bullmq + REDIS_URL)
 */
export interface JobQueue {
  readonly driver: 'inprocess' | 'bullmq';
  enqueue(type: JobType, payload: Record<string, unknown>, opts?: { delayMs?: number; dedupeKey?: string }): Promise<string>;
  start(handler: JobHandler): Promise<void>;
  stop(): Promise<void>;
  /** Process everything currently due, synchronously. Used by tests and the seed script. */
  drain(): Promise<number>;
}

const MAX_ATTEMPTS = 3;

export class InProcessQueue implements JobQueue {
  readonly driver = 'inprocess' as const;
  private handler: JobHandler | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

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
    // Reset jobs left "running" by a previous process.
    await this.db.update(jobs).set({ status: 'queued' }).where(eq(jobs.status, 'running'));
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

  async drain(): Promise<number> {
    if (!this.handler) return 0;
    let processed = 0;
    for (;;) {
      const [job] = await this.db
        .select()
        .from(jobs)
        .where(and(eq(jobs.status, 'queued'), lte(jobs.runAt, new Date())))
        .orderBy(asc(jobs.runAt), asc(jobs.createdAt))
        .limit(1);
      if (!job) break;
      await this.db.update(jobs).set({ status: 'running', attempts: sql`${jobs.attempts} + 1`, updatedAt: new Date() }).where(eq(jobs.id, job.id));
      try {
        await this.handler({ id: job.id, type: job.type as JobType, payload: job.payload as Record<string, unknown>, attempts: job.attempts + 1 });
        await this.db.update(jobs).set({ status: 'done', updatedAt: new Date() }).where(eq(jobs.id, job.id));
      } catch (err) {
        const attempts = job.attempts + 1;
        const message = err instanceof Error ? err.message : String(err);
        await this.db
          .update(jobs)
          .set({ status: attempts >= MAX_ATTEMPTS ? 'failed' : 'queued', error: message, runAt: new Date(Date.now() + 5_000 * attempts), updatedAt: new Date() })
          .where(eq(jobs.id, job.id));
      }
      processed++;
    }
    return processed;
  }
}

