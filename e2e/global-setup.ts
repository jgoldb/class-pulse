import { existsSync } from 'node:fs';
import { clerkSetup } from '@clerk/testing/playwright';

/**
 * Prime Clerk testing tokens (bypasses bot detection on the development instance). Database
 * reset and seeding happen in e2e/start-api.mjs, before the API answers /health, so tests never
 * race the schema.
 */
export default async function globalSetup() {
  if (existsSync('.env')) process.loadEnvFile('.env');
  await clerkSetup({ publishableKey: process.env.CLERK_PUBLISHABLE_KEY, frontendApiUrl: undefined });
}
