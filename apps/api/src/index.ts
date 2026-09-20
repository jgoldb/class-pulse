import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from './bootstrap';
import { startScheduler } from './jobs/scheduler';
import { buildServer } from './server';

// Load the repo-root .env without a dependency (Node 22).
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
  const app = await createApp();
  const server = await buildServer(app.ctx);
  const stopScheduler = startScheduler(app.ctx);
  const shutdown = async () => {
    stopScheduler();
    await server.close();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
  await server.listen({ port: app.ctx.config.port, host: '0.0.0.0' });
  server.log.info(
    { port: app.ctx.config.port, db: app.db.kind, jobs: app.ctx.queue.driver, provider: app.ctx.gate.providerName, model: app.ctx.aiConfig.model, effort: app.ctx.aiConfig.reasoningEffort, posture: app.ctx.config.deploymentPosture, auth: 'clerk' },
    'class-pulse api ready',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
