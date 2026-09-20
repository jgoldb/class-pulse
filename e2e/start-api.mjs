// Launches the API for the e2e harness: reset + seed the e2e branch first (unless
// E2E_SKIP_SEED=1), then start the server. Playwright waits on /health, which only answers
// once the seed has finished, so tests never race the database.
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const env = { ...process.env };
if (!env.DATABASE_URL) throw new Error('DATABASE_URL (the e2e branch) must be set by playwright.config.ts');

if (env.E2E_SKIP_SEED === '1') {
  console.log('[e2e] E2E_SKIP_SEED=1 — reusing the existing e2e database');
} else {
  console.log('[e2e] resetting and seeding the e2e branch (this calls the model; ~2–3 minutes)…');
  const t0 = Date.now();
  const r = spawnSync('npx', ['tsx', 'src/seed.ts', '--reset'], { cwd: resolve('apps/api'), env, stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    console.error(`[e2e] seed failed with exit ${r.status}`);
    process.exit(r.status ?? 1);
  }
  console.log(`[e2e] seeded in ${Math.round((Date.now() - t0) / 1000)}s`);
}

const api = spawn('npx', ['tsx', 'src/index.ts'], { cwd: resolve('apps/api'), env, stdio: 'inherit', shell: true });
api.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => api.kill());
