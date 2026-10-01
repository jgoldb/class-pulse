/**
 * Logical backup and restore (guide §P). A backup is every application table as JSON; a restore
 * loads one into an empty, migrated database in foreign-key order. This complements the
 * database provider's point-in-time recovery: it is portable, checkable and drillable.
 *
 *   npm run db:backup  -- --target <local|e2e> [--out file]
 *   npm run db:restore -- --target <local|e2e> --in file --yes      (refuses a non-empty database)
 *
 * Backups contain identified and classroom data. They are written to backups/ (gitignored) and
 * must be stored and deleted under the school's data-handling policy (docs/10).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { getTableColumns, is, sql } from 'drizzle-orm';
import type { Db } from './client';
import * as schema from './schema';

type Table = PgTable;
export type Backup = { format: 'pulsera.backup.v1'; createdAt: string; tables: Record<string, Array<Record<string, unknown>>> };

const keyOf = (t: Table) => { const c = getTableConfig(t); return `${c.schema ?? 'public'}.${c.name}`; };

/** Every application table, parents before children. */
export function orderedTables(): Table[] {
  const tables = Object.values(schema).filter((v) => is(v, PgTable)) as unknown as Table[];
  const byKey = new Map(tables.map((t) => [keyOf(t), t]));
  const ordered: Table[] = [];
  const seen = new Set<string>();
  const visit = (t: Table, path: Set<string>) => {
    const key = keyOf(t);
    if (seen.has(key) || path.has(key)) return;
    path.add(key);
    for (const fk of getTableConfig(t).foreignKeys) {
      const parent = fk.reference().foreignTable as Table;
      const parentKey = keyOf(parent);
      if (parentKey !== key && byKey.has(parentKey)) visit(byKey.get(parentKey)!, path);
    }
    seen.add(key); ordered.push(t);
  };
  for (const t of tables) visit(t, new Set());
  return ordered;
}

export async function backupDatabase(db: Db, now = new Date()): Promise<Backup> {
  const tables: Backup['tables'] = {};
  for (const t of orderedTables()) tables[keyOf(t)] = (await db.select().from(t)) as Array<Record<string, unknown>>;
  return { format: 'pulsera.backup.v1', createdAt: now.toISOString(), tables: JSON.parse(JSON.stringify(tables)) };
}

export async function rowCounts(db: Db) {
  const counts: Record<string, number> = {};
  for (const t of orderedTables()) counts[keyOf(t)] = Number((await db.select({ n: sql<number>`count(*)` }).from(t))[0]!.n);
  return counts;
}

export async function restoreDatabase(db: Db, backup: Backup) {
  if (backup.format !== 'pulsera.backup.v1') throw new Error('Unrecognised backup format');
  const existing = Object.entries(await rowCounts(db)).filter(([, n]) => n > 0);
  if (existing.length) throw new Error(`Refusing to restore into a database that has data (${existing.map(([k]) => k).join(', ')}). Empty it first.`);
  await db.transaction(async (tx) => {
    for (const t of orderedTables()) {
      const rows = backup.tables[keyOf(t)] ?? [];
      if (!rows.length) continue;
      // JSON turns timestamps into strings; give timestamp columns their Date back.
      const dates = Object.entries(getTableColumns(t)).filter(([, c]) => c.dataType === 'date').map(([prop]) => prop);
      const revived = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v !== null && dates.includes(k) ? new Date(v as string) : v])));
      for (let i = 0; i < revived.length; i += 500) await tx.insert(t).values(revived.slice(i, i + 500) as never);
    }
  });
  return rowCounts(db);
}

async function main() {
  const [command] = process.argv.slice(2);
  const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; };
  for (const candidate of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) if (existsSync(candidate)) { try { process.loadEnvFile(candidate); } catch { /* ignore */ } break; }
  const target = arg('target');
  const url = target === 'e2e' ? process.env.DATABASE_URL_E2E : target === 'local' ? process.env.DATABASE_URL : undefined;
  if (!url || !['backup', 'restore'].includes(command ?? '')) { console.error('usage: backup.ts <backup|restore> --target <local|e2e> [--out file | --in file --yes]'); process.exit(1); }
  const { openDb } = await import('./client');
  const handle = await openDb({ url });
  try {
    if (command === 'backup') {
      const data = await backupDatabase(handle.db);
      const dir = resolve(process.cwd(), 'backups');
      mkdirSync(dir, { recursive: true });
      const out = arg('out') ?? resolve(dir, `pulsera-${target}-${data.createdAt.replace(/[:.]/g, '-')}.json`);
      writeFileSync(out, JSON.stringify(data));
      const total = Object.values(data.tables).reduce((n, rows) => n + rows.length, 0);
      console.log(`[db] backup complete: ${Object.keys(data.tables).length} tables, ${total} rows → ${out}`);
    } else {
      if (!process.argv.includes('--yes')) { console.error('Restore writes every row of the backup. Re-run with --yes.'); process.exit(1); }
      const file = arg('in');
      if (!file) { console.error('--in <file> is required'); process.exit(1); }
      const counts = await restoreDatabase(handle.db, JSON.parse(readFileSync(file, 'utf8')) as Backup);
      console.log(`[db] restore complete: ${Object.values(counts).reduce((a, b) => a + b, 0)} rows`);
    }
  } finally { await handle.close(); }
}
if (process.argv[1]?.endsWith('backup.ts')) void main().catch((e) => { console.error(`[db] ${e instanceof Error ? e.message : e}`); process.exit(1); });
