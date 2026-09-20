import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DbHandle {
  db: Db;
  kind: 'postgres' | 'memory';
  close(): Promise<void>;
}

const MIGRATIONS_FOLDER = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');

/**
 * Postgres over node-postgres (Neon in every real environment). The same migrations run on an
 * in-memory PGlite instance for the integration test suite only, so tests need no network.
 */
export async function openDb(opts: { url: string | null; memory?: boolean }): Promise<DbHandle> {
  if (opts.memory) {
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle } = await import('drizzle-orm/pglite');
    const { migrate } = await import('drizzle-orm/pglite/migrator');
    const client = new PGlite();
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    return { db: db as unknown as Db, kind: 'memory', close: () => client.close() };
  }
  if (!opts.url) throw new Error('DATABASE_URL is required');
  const { Pool } = await import('pg');
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  // Neon gives sslmode=require; pg treats it as verify-full and warns about the future change. Be explicit.
  const url = opts.url.replace(/sslmode=(require|prefer|verify-ca)/, 'sslmode=verify-full');
  const pool = new Pool({ connectionString: url, max: 8 });
  const db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { db: db as unknown as Db, kind: 'postgres', close: () => pool.end() };
}

export { schema };
