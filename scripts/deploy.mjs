// `npm run deploy` — fly deploy with the one build arg the Dockerfile requires.
//
// VITE_CLERK_PUBLISHABLE_KEY is inlined into the client bundle by Vite, so it has to be present
// at build time rather than as a runtime secret. A bare `fly deploy` fails on it, and only after
// the remote builder has spun up, so the mistake is slow to discover. This resolves the key the
// same way the rest of the repo does — the environment first, then the root .env — and passes it
// through. Extra arguments are forwarded: `npm run deploy -- --now`.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const KEY = 'VITE_CLERK_PUBLISHABLE_KEY';

// loadEnvFile does not overwrite variables already in the environment, so an exported value wins.
const envFile = resolve('.env');
if (existsSync(envFile)) {
  try {
    process.loadEnvFile(envFile);
  } catch {
    /* a malformed .env is not worth failing the deploy over; the check below still catches it */
  }
}

const key = process.env[KEY]?.trim();
if (!key) {
  console.error(`[deploy] ${KEY} is not set.`);
  console.error(`[deploy] Add it to .env at the repo root, or export it, then run again.`);
  console.error(`[deploy] It is the Clerk publishable key (pk_...), not the secret key.`);
  process.exit(1);
}
if (!key.startsWith('pk_')) {
  console.error(`[deploy] ${KEY} does not look like a Clerk publishable key (expected a pk_ prefix).`);
  process.exit(1);
}

const passthrough = process.argv.slice(2);
// Respect an explicit --build-arg for this key rather than passing it twice.
const alreadyGiven = passthrough.some((a) => a.includes(KEY));

// Only describe the key we are actually supplying; an explicit --build-arg may be a different one.
if (alreadyGiven) {
  console.log(`[deploy] ${KEY} given explicitly; passing your arguments through unchanged.`);
} else {
  if (key.startsWith('pk_test_')) {
    console.warn(`[deploy] note: this is a development Clerk instance (pk_test_). The deployed site`);
    console.warn(`[deploy] will authenticate against it, including its relaxed verification rules.`);
  }
  console.log(`[deploy] fly deploy with ${KEY}=${key.slice(0, 11)}…`);
}

const args = ['deploy', ...(alreadyGiven ? [] : ['--build-arg', `${KEY}=${key}`]), ...passthrough];
const fly = spawn('fly', args, { stdio: 'inherit', shell: true });
fly.on('exit', (code) => process.exit(code ?? 0));
fly.on('error', (err) => {
  console.error(`[deploy] could not run flyctl: ${err.message}`);
  process.exit(1);
});
