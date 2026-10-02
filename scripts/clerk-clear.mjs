// Delete every user and revoke every pending invitation in the Clerk *development* instance.
// The dashboard only deletes one user at a time; this uses the Backend API instead.
//
//   node scripts/clerk-clear.mjs          dry run: lists what would go, changes nothing
//   node scripts/clerk-clear.mjs --yes    deletes the users and revokes the invitations
//
// Reads CLERK_SECRET_KEY from the environment or the repo-root .env. Refuses live (production)
// keys. The dev instance is shared by local, e2e and Fly, so all three lose their sign-ins until
// they are reseeded (`npm run db:reseed -- --target <local|fly>`; e2e reseeds itself).
import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');
const key = process.env.CLERK_SECRET_KEY;
if (!key) throw new Error('CLERK_SECRET_KEY is not set (environment or .env).');
if (!key.startsWith('sk_test_')) throw new Error('Refusing: this is not a development (sk_test_) key.');
const execute = process.argv.includes('--yes');

const API = 'https://api.clerk.com/v1';
async function clerk(method, path) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}${path}`, { method, headers: { authorization: `Bearer ${key}` } });
    if (res.status === 429 && attempt < 5) {
      // Rate limited: wait as long as Clerk asks (or a second), then retry.
      await new Promise((r) => setTimeout(r, 1000 * Number(res.headers.get('retry-after') ?? 1)));
      continue;
    }
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
    return res.json();
  }
}

async function all(path) {
  const out = [];
  for (let offset = 0; ; offset += 100) {
    const page = await clerk('GET', `${path}${path.includes('?') ? '&' : '?'}limit=100&offset=${offset}`);
    const rows = Array.isArray(page) ? page : page.data ?? [];
    out.push(...rows);
    if (rows.length < 100) return out;
  }
}

const users = await all('/users?order_by=-created_at');
const invitations = await all('/invitations?status=pending');
const email = (u) => u.email_addresses?.find((e) => e.id === u.primary_email_address_id)?.email_address ?? u.email_addresses?.[0]?.email_address ?? u.id;

console.log(`${users.length} user(s):`);
for (const u of users) console.log(`  ${email(u)}`);
console.log(`${invitations.length} pending invitation(s):`);
for (const i of invitations) console.log(`  ${i.email_address}`);

if (!execute) {
  console.log('\nDry run — nothing changed. Re-run with --yes to delete these users and revoke these invitations.');
  process.exit(0);
}

let done = 0;
for (const u of users) {
  await clerk('DELETE', `/users/${u.id}`);
  done++;
  if (done % 10 === 0) console.log(`  deleted ${done}/${users.length}`);
}
for (const i of invitations) await clerk('POST', `/invitations/${i.id}/revoke`);
console.log(`\nDeleted ${users.length} user(s) and revoked ${invitations.length} invitation(s).`);
