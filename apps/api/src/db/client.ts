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

/** The schemas the migrations own. Dropping them (and drizzle's bookkeeping) empties the app. */
const APP_SCHEMAS = ['working', 'identified', 'drizzle'] as const;

// Neon gives sslmode=require; pg treats it as verify-full and warns about the future change. Be explicit.
const pgUrl = (url: string) => url.replace(/sslmode=(require|prefer|verify-ca)/, 'sslmode=verify-full');

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
  const pool = new Pool({ connectionString: pgUrl(opts.url), max: 8 });
  try {
    await assertMigrationLineage(pool);
  } catch (err) {
    await pool.end();
    throw err;
  }
  const db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { db: db as unknown as Db, kind: 'postgres', close: () => pool.end() };
}

/**
 * Drop the application schemas without migrating first. The reset tools (`seed --reset`,
 * `db:empty`) use this so they also work on a database whose migration history no longer matches
 * this checkout — which is exactly the database that needs resetting.
 */
export async function dropAppSchemas(url: string) {
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: pgUrl(url), max: 1 });
  try {
    for (const name of APP_SCHEMAS) await pool.query(`DROP SCHEMA IF EXISTS "${name}" CASCADE`);
  } finally {
    await pool.end();
  }
}

/**
 * The migrations were squashed into one baseline on 2026-10-02 (docs/08). A database migrated by
 * the retired chain records a different first migration; letting drizzle loose on it would fail
 * halfway with "schema already exists". Say what happened and how to fix it instead.
 */
async function assertMigrationLineage(pool: import('pg').Pool) {
  const { readMigrationFiles } = await import('drizzle-orm/migrator');
  const [baseline] = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER });
  let first: string | undefined;
  try {
    const r = await pool.query<{ hash: string }>('SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at ASC, id ASC LIMIT 1');
    first = r.rows[0]?.hash;
  } catch (err) {
    if ((err as { code?: string }).code === '42P01' || (err as { code?: string }).code === '3F000') return; // never migrated
    throw err;
  }
  if (first && baseline && first !== baseline.hash) {
    throw new Error(
      'This database was migrated by a migration history that has since been squashed into one baseline. ' +
        'It cannot be upgraded in place; reset it: `npm run db:reseed -- --target <local|e2e|fly>` (demo data) or `npm run db:empty -- --target <…>` (no rows).',
    );
  }
}

export { schema };
