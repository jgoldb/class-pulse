import { loadConfig, type AppConfig } from './config';
import type { AppContext } from './context';
import { createClerkAuth, createTestAuth } from './auth/clerk';
import { openDb, type DbHandle } from './db/client';
import { makeJobHandler } from './jobs/handlers';
import { InProcessQueue, type JobQueue } from './jobs/queue';
import { buildGate } from './services/ai';
import { seedPrompts } from './services/prompts';

export interface AppHandle {
  ctx: AppContext;
  db: DbHandle;
  close(): Promise<void>;
}

/**
 * Assemble the application context: config, database (migrated), Clerk auth, egress gate, prompt
 * registry, and the job queue with its handler attached. Used by the server, the seed script,
 * the e2e harness and the integration tests.
 */
export async function createApp(opts: { env?: NodeJS.ProcessEnv; memory?: boolean; config?: Partial<AppConfig>; now?: () => Date; pollMs?: number } = {}): Promise<AppHandle> {
  const env = opts.env ?? process.env;
  const config = { ...loadConfig(env), ...opts.config };
  const handle = await openDb({ url: config.database.url, memory: opts.memory });
  await seedPrompts(handle.db);
  const { gate, aiConfig, provider } = buildGate(handle.db, env);
  const auth = config.clerk ? createClerkAuth(config.clerk) : createTestAuth();
  const queue: JobQueue = new InProcessQueue(handle.db, opts.pollMs ?? 1000);
  const log = {
    info: (o: unknown, msg?: string) => (config.nodeEnv === 'test' ? undefined : console.log(msg ?? '', typeof o === 'object' ? JSON.stringify(o) : o)),
    warn: (o: unknown, msg?: string) => console.warn(msg ?? '', o),
    error: (o: unknown, msg?: string) => console.error(msg ?? '', o),
  };
  const ctx: AppContext = { config, db: handle.db, auth, gate, aiConfig, provider, queue, now: opts.now ?? (() => new Date()), log };
  await queue.start(makeJobHandler(ctx));
  return {
    ctx,
    db: handle,
    close: async () => {
      await queue.stop();
      await handle.close();
    },
  };
}
