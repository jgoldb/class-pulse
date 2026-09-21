// `npm run db:reseed` / `npm run db:empty` — the two destructive database chores, with the
// target spelled out and a confirmation before anything is dropped.
//
//   npm run db:reseed -- --target fly     reset + seed (the scripted demo case, through the model)
//   npm run db:empty  -- --target local   drop everything, re-run migrations, leave no rows
//
// Targets are never implied, because all three are destructive and they are easy to mix up:
//
//   local   DATABASE_URL      from the environment or the root .env (the `production` branch)
//   e2e     DATABASE_URL_E2E  the branch the Playwright harness owns
//   fly     the deployment — the command runs inside the machine over `fly ssh console`, against
//           the DATABASE_URL in its own secrets, so that connection string stays on the machine.
//           The machine is restarted afterwards: both actions drop schemas the live pool is
//           holding, and the API reads the prompt registry at boot.
//
// Flags: --yes skips the prompt (required when stdin is not a terminal), --no-restart leaves the
// Fly machine alone.
//
// Note for the `fly` target: the remote side runs whatever is in the deployed image, so
// `--target fly --action empty` needs an image built since apps/api/src/db/empty.ts was added.
// Run `npm run deploy` first if it reports that the script is missing.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';

const ACTIONS = {
  reseed: {
    blurb: 'RESEED — drop every table, re-run migrations, then seed the demo workspace.',
    cost: 'Calls the model for two plan drafts and the pattern interpretation; takes a few minutes.',
    remote: 'cd /app && npm run seed --workspace apps/api -- --reset',
    local: ['tsx', 'src/seed.ts', '--reset'],
    // flyctl on Windows can exit non-zero after the remote command finished, so success is read
    // from the output rather than the exit code.
    sentinel: 'Seed complete',
  },
  empty: {
    blurb: 'EMPTY — drop every table and re-run migrations, leaving no rows at all.',
    cost: 'No model calls. The first person to sign in afterwards goes through workspace onboarding.',
    remote: 'cd /app && npm run db:empty --workspace apps/api -- --yes',
    local: ['tsx', 'src/db/empty.ts', '--yes'],
    sentinel: '[db] empty complete',
  },
};

const argv = process.argv.slice(2);
const action = ACTIONS[argv[0]] ? argv[0] : null;
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : null;
};
const has = (name) => argv.includes(`--${name}`);
const target = flag('target');

if (!action || !['local', 'e2e', 'fly'].includes(target)) {
  console.error('usage: npm run db:reseed -- --target <local|e2e|fly>');
  console.error('       npm run db:empty  -- --target <local|e2e|fly>');
  console.error('       flags: --yes (skip the prompt)  --no-restart (leave the Fly machine running)');
  process.exit(1);
}

// loadEnvFile does not overwrite variables already in the environment, so an exported value wins.
const envFile = resolve('.env');
if (existsSync(envFile)) {
  try {
    process.loadEnvFile(envFile);
  } catch {
    /* a malformed .env is not worth failing on; the missing-variable check below is clearer */
  }
}

function flyApp() {
  const toml = readFileSync(resolve('fly.toml'), 'utf8');
  const m = toml.match(/^app\s*=\s*['"]([^'"]+)['"]/m);
  if (!m) throw new Error('could not read the app name from fly.toml');
  return m[1];
}

/** Where the work will land, in words the confirmation can be read against. */
function describe() {
  if (target === 'fly') return `the deployment — Fly app ${flyApp()}, its own DATABASE_URL secret`;
  const name = target === 'e2e' ? 'DATABASE_URL_E2E' : 'DATABASE_URL';
  const url = process.env[name];
  if (!url) {
    console.error(`[db] ${name} is not set (environment or .env).`);
    process.exit(1);
  }
  let where = url;
  try {
    const u = new URL(url);
    where = `${u.host}${u.pathname}`;
  } catch {
    /* an unparseable URL still gets shown, minus anything that looks like a password */
    where = url.replace(/\/\/([^:]*):[^@]*@/, '//$1:***@');
  }
  const branch = target === 'local' && process.env.NEON_BRANCH ? `  (NEON_BRANCH=${process.env.NEON_BRANCH})` : '';
  return `${name} → ${where}${branch}`;
}

function run(cmd, args, opts = {}) {
  return new Promise((done) => {
    const child = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    for (const [stream, sink] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        out += chunk;
        sink.write(chunk);
      });
    }
    child.on('error', (error) => done({ code: null, out, error }));
    child.on('close', (code) => done({ code, out }));
  });
}

const FLY = process.platform === 'win32' ? 'fly.exe' : 'fly';

async function main() {
  const spec = ACTIONS[action];
  const where = describe();
  console.log(`\n[db] ${spec.blurb}`);
  console.log(`[db] target: ${where}`);
  console.log(`[db] ${spec.cost}`);
  console.log('[db] This cannot be undone.\n');

  if (!has('yes')) {
    if (!process.stdin.isTTY) {
      console.error('[db] stdin is not a terminal, so there is nobody to ask. Re-run with --yes if you mean it.');
      process.exit(1);
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`[db] Type the target name (${target}) to continue: `);
    rl.close();
    if (answer.trim() !== target) {
      console.log('[db] Aborted, nothing was changed.');
      process.exit(1);
    }
  }

  const t0 = Date.now();
  let result;
  if (target === 'fly') {
    const app = flyApp();
    console.log(`[db] running inside ${app}…\n`);
    result = await run(FLY, ['ssh', 'console', '-a', app, '-C', `/bin/sh -lc '${spec.remote}'`]);
    if (result.error?.code === 'ENOENT') {
      console.error(`[db] could not run flyctl: ${result.error.message}`);
      process.exit(1);
    }
  } else {
    const url = process.env[target === 'e2e' ? 'DATABASE_URL_E2E' : 'DATABASE_URL'];
    console.log('[db] running locally…\n');
    result = await run('npx', spec.local, { cwd: resolve('apps/api'), env: { ...process.env, DATABASE_URL: url }, shell: true });
  }

  const ok = result.out.includes(spec.sentinel);
  const secs = Math.round((Date.now() - t0) / 1000);
  if (!ok) {
    console.error(`\n[db] ${action} did not finish (exit ${result.code}) after ${secs}s — the database may be half-dropped. Read the output above.`);
    process.exit(result.code || 1);
  }
  if (result.code !== 0) {
    // Seen with flyctl on Windows: "Error: The handle is invalid." as the SSH session is torn
    // down, after the remote command has already printed its result.
    console.log(`\n[db] ${action} finished in ${secs}s. (flyctl exited ${result.code} tearing the session down; the run itself completed.)`);
  } else {
    console.log(`\n[db] ${action} finished in ${secs}s.`);
  }

  if (target === 'fly' && !has('no-restart')) {
    const app = flyApp();
    console.log(`[db] restarting ${app} — the live pool is holding schemas that were just dropped…\n`);
    const restart = await run(FLY, ['apps', 'restart', app]);
    if (restart.code !== 0 && !restart.out.includes('restarted successfully')) {
      console.error(`\n[db] the restart did not report success. Run: fly apps restart ${app}`);
      process.exit(restart.code || 1);
    }
    console.log('\n[db] Machine restarted; /health answers once migrations have run.');
  } else if (target !== 'fly') {
    console.log('[db] If an API process was already running against this database, restart it.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
