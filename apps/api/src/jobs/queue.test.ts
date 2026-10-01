import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb, type DbHandle } from '../db/client';
import { jobs } from '../db/schema';
import { InProcessQueue } from './queue';

/**
 * These cover the claim path specifically, because getting it wrong is expensive and silent: a
 * duplicated `generate_plan` is a second model call and a second draft for the same case, with
 * nothing in the UI to suggest it happened twice.
 */
let handle: DbHandle;

beforeAll(async () => {
  handle = await openDb({ url: null, memory: true });
});

afterAll(async () => {
  await handle.close();
});

beforeEach(async () => {
  await handle.db.delete(jobs);
});

/** A queue that never polls on its own, so each test drives it explicitly. */
const queue = () => new InProcessQueue(handle.db, 60_000);

const statusOf = async (id: string) => {
  const [row] = await handle.db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
  return row;
};

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);

describe('InProcessQueue claiming', () => {
  it('runs a due job exactly once and marks it done', async () => {
    const q = queue();
    const seen: string[] = [];
    await q.start(async (job) => void seen.push(job.id));
    const id = await q.enqueue('sweep_all', {});

    await q.drain();
    await q.drain(); // a second pass must find nothing left to do

    expect(seen).toEqual([id]);
    expect((await statusOf(id))?.status).toBe('done');
    await q.stop();
  });

  it('gives each job to exactly one of two competing pollers', async () => {
    const a = queue();
    const b = queue();
    const seen: string[] = [];
    const handler = async (job: { id: string }) => {
      seen.push(job.id);
    };
    await a.start(handler);
    await b.start(handler);

    const ids = [];
    for (let i = 0; i < 5; i++) ids.push(await a.enqueue('sweep_case', { n: i }, { dedupeKey: `case-${i}` }));

    await Promise.all([a.drain(), b.drain()]);

    expect(seen.slice().sort()).toEqual(ids.slice().sort());
    expect(new Set(seen).size).toBe(seen.length); // no job ran twice
    await a.stop();
    await b.stop();
  });

  it('does not increment attempts past the claim that ran', async () => {
    const q = queue();
    await q.start(async () => {});
    const id = await q.enqueue('sweep_all', {});
    await q.drain();
    expect((await statusOf(id))?.attempts).toBe(1);
    await q.stop();
  });
});

describe('InProcessQueue recovery', () => {
  it('renews a running job so a second worker cannot reclaim it', async () => {
    const a = new InProcessQueue(handle.db, 60_000, 20);
    const b = queue();
    let release!: () => void;
    let started!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const begun = new Promise<void>((resolve) => { started = resolve; });
    await a.start(async () => { started(); await held; });
    const id = await a.enqueue('sweep_all', {});
    const draining = a.drain();
    await begun;
    try {
      await handle.db.update(jobs).set({ updatedAt: minutesAgo(30) }).where(eq(jobs.id, id));
      await expect.poll(async () => (await statusOf(id))!.updatedAt.getTime()).toBeGreaterThan(minutesAgo(1).getTime());
      let duplicateRuns = 0;
      await b.start(async () => { duplicateRuns++; });
      await b.drain();
      expect(duplicateRuns).toBe(0);
      expect((await statusOf(id))?.status).toBe('running');
    } finally {
      release();
      await draining;
      await a.stop();
      await b.stop();
    }
    expect((await statusOf(id))?.status).toBe('done');
    expect((await statusOf(id))?.leaseToken).toBeNull();
  });

  it.each([false, true])('an old worker cannot overwrite re-enqueued work (failure=%s)', async (fail) => {
    const q = queue();
    let release!: () => void;
    let started!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const begun = new Promise<void>((resolve) => { started = resolve; });
    await q.start(async () => { started(); await held; if (fail) throw new Error('old attempt failed'); });
    const id = await q.enqueue('sweep_case', { version: 1 }, { dedupeKey: 'same-case' });
    const draining = q.drain();
    await begun;
    try {
      // Delayed replacement prevents this drain from processing the new generation itself.
      await q.enqueue('sweep_case', { version: 2 }, { dedupeKey: 'same-case', delayMs: 60_000 });
    } finally {
      release();
      await draining;
      await q.stop();
    }
    const row = await statusOf(id);
    expect(row).toMatchObject({ status: 'queued', attempts: 0, leaseToken: null, error: null, payload: { version: 2 } });
  });

  it('fences a previous owner after an expired lease is reclaimed and claimed again', async () => {
    const a = queue(), b = queue();
    let releaseA!: () => void, releaseB!: () => void, startA!: () => void, startB!: () => void;
    const heldA = new Promise<void>((resolve) => { releaseA = resolve; });
    const heldB = new Promise<void>((resolve) => { releaseB = resolve; });
    const begunA = new Promise<void>((resolve) => { startA = resolve; });
    const begunB = new Promise<void>((resolve) => { startB = resolve; });
    await a.start(async () => { startA(); await heldA; });
    const id = await a.enqueue('sweep_all', {});
    const drainA = a.drain();
    let drainB: Promise<number> | null = null;
    await begunA;
    try {
      const oldToken = (await statusOf(id))!.leaseToken;
      await handle.db.update(jobs).set({ updatedAt: minutesAgo(30) }).where(eq(jobs.id, id));
      await b.start(async () => { startB(); await heldB; });
      drainB = b.drain();
      await begunB;
      const newToken = (await statusOf(id))!.leaseToken;
      expect(newToken).not.toBe(oldToken);
      releaseA();
      await drainA;
      expect(await statusOf(id)).toMatchObject({ status: 'running', attempts: 2, leaseToken: newToken });
    } finally {
      releaseA(); releaseB();
      await Promise.all([drainA, drainB]);
      await a.stop(); await b.stop();
    }
    expect((await statusOf(id))?.status).toBe('done');
  });

  it('leaves another live worker\'s in-flight job alone on startup', async () => {
    // The bug this replaced reset every 'running' row at boot, so starting a second process
    // re-queued work the first one was still doing.
    await handle.db.insert(jobs).values({ id: 'fresh', type: 'generate_plan', payload: {}, status: 'running', attempts: 1, updatedAt: minutesAgo(1) });

    const q = queue();
    await q.start(async () => {});

    expect((await statusOf('fresh'))?.status).toBe('running');
    await q.stop();
  });

  it('re-queues a job abandoned by a dead worker', async () => {
    await handle.db.insert(jobs).values({ id: 'stale', type: 'generate_plan', payload: {}, status: 'running', attempts: 1, updatedAt: minutesAgo(30) });

    const q = queue();
    await q.start(async () => {});

    const row = await statusOf('stale');
    expect(row?.status).toBe('queued');
    expect(row?.error).toMatch(/stopped before finishing/);
    await q.stop();
  });

  it('fails an abandoned job that has already used its attempts', async () => {
    await handle.db.insert(jobs).values({ id: 'poison', type: 'generate_plan', payload: {}, status: 'running', attempts: 3, updatedAt: minutesAgo(30) });

    const q = queue();
    await q.start(async () => {});

    expect((await statusOf('poison'))?.status).toBe('failed');
    await q.stop();
  });
});
