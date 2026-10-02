/**
 * Empty the database: drop the application schemas and re-run the migrations, leaving the tables
 * in place with nothing in them. The counterpart to the seed, for when a demo should start from
 * nothing rather than from the scripted case.
 *
 *   npm run db:empty --workspace apps/api -- --yes
 *
 * `scripts/db.mjs` at the repo root is the way in: it names the target, asks for confirmation,
 * and on Fly restarts the machine afterwards. The --yes flag is what keeps this from running by
 * accident — there is no interactive prompt here, because over `fly ssh console` there is no
 * terminal to prompt on.
 *
 * This lives under apps/api rather than in scripts/ so that it ships inside the deployment image:
 * the Dockerfile copies apps/api whole, which is what lets the Fly machine run it against its own
 * DATABASE_URL without the connection string ever leaving the machine.
 *
 * The prompt registry is not re-seeded here; `createApp` calls `seedPrompts` on every boot, so it
 * comes back with the API. The workspace does not come back — an empty database sends the first
 * person who signs in through workspace onboarding.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { dropAppSchemas, openDb } from './client';

for (const candidate of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) {
  if (existsSync(candidate)) {
    try {
      process.loadEnvFile(candidate);
    } catch {
      /* ignore */
    }
    break;
  }
}

async function main() {
  if (!process.argv.includes('--yes')) {
    console.error('db:empty drops every table in the database. Re-run with --yes, or use `npm run db:empty` at the repo root, which names the target and asks first.');
    process.exit(1);
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');

  // Drop without migrating first, so this also empties a database from an older migration
  // history (db/client.ts) — the one case where running the migrations would fail.
  await dropAppSchemas(url);
  console.log('Schemas dropped. Re-running migrations…');

  const fresh = await openDb({ url });
  await fresh.close();
  // scripts/db.mjs looks for this line: flyctl on Windows can exit non-zero after a run that
  // finished, so the sentinel is more reliable than the exit code.
  console.log('[db] empty complete — tables exist, no rows. The first sign-in goes through workspace onboarding.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
