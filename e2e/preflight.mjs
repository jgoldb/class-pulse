import { Pool } from 'pg';

/** Read-only guard before the harness may migrate or reset its dedicated synthetic database. */
export async function verifyE2eEnvironment(env = process.env) {
  const target = env.DATABASE_URL_E2E;
  if (!target || !env.DATABASE_URL) throw new Error('Both main and dedicated E2E database settings are required for isolation verification');
  const identity = (value) => { const u = new URL(value); return `${u.hostname.replace(/-pooler(?=\.)/, '')}:${u.port || '5432'}${u.pathname}`; };
  if (identity(target) === identity(env.DATABASE_URL)) throw new Error('E2E database must be separate from the main database');
  if (!env.CLERK_PUBLISHABLE_KEY?.startsWith('pk_test_') || !env.CLERK_SECRET_KEY?.startsWith('sk_test_')) throw new Error('E2E requires Clerk development-instance keys');
  const pool = new Pool({ connectionString: target.replace(/sslmode=(require|prefer|verify-ca)/, 'sslmode=verify-full'), connectionTimeoutMillis: 10000 });
  try {
    const tables = await pool.query("select to_regclass('identified.students') as students");
    if (tables.rows[0].students) {
      const result = await pool.query('select count(*)::int as total, count(*) filter (where synthetic is not true)::int as real from identified.students');
      if (result.rows[0].real !== 0) throw new Error('E2E database contains non-synthetic learners; reset refused');
      console.log(`[e2e] Verified separate database with ${result.rows[0].total} synthetic learners and development authentication`);
    } else console.log('[e2e] Verified separate empty database and development authentication');
  } finally { await pool.end(); }
}
