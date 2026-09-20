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
