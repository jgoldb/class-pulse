import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { eq } from 'drizzle-orm';
import { ZodError } from 'zod';
import { users } from './db/schema';
import { HttpError, type Actor, type AppContext } from './context';
import { provisionFromInvitation, userBySubject } from './auth/clerk';
import { buildActor } from './services/scope';
import { registerAuthRoutes } from './routes/auth';
import { registerCaseRoutes } from './routes/cases';
import { registerPlanRoutes } from './routes/plans';
import { registerSignalRoutes } from './routes/signals';
import { registerPatternRoutes } from './routes/patterns';
import { registerReviewRoutes } from './routes/reviews';
import { registerAdminRoutes } from './routes/admin';
import { registerPiiRoutes } from './routes/pii';

declare module 'fastify' {
  interface FastifyRequest {
    /** Provisioned Class Pulse user with resolved scope. Null when not signed in or not yet provisioned. */
    actor: Actor | null;
    /** Verified Clerk subject, present whenever a valid session token was sent. */
    subject: string | null;
  }
}

/** Paths a signed-in but not-yet-provisioned person may call (workspace onboarding). */
const IDENTITY_ONLY = ['/api/onboarding/', '/auth/me'];
/** Paths that need no session at all (the simulated Stripe checkout happens before an account exists). */
const PUBLIC = ['/health', '/api/signup/'];

const REDACT_PATHS = ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]', 'body', 'email', '*.email', '*.displayName', '*.firstName', '*.lastName'];

export async function buildServer(ctx: AppContext, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger === false ? false : { level: ctx.config.nodeEnv === 'test' ? 'silent' : 'info', redact: { paths: REDACT_PATHS, censor: '[redacted]' } },
    trustProxy: true,
  });
  await app.register(cors, { origin: ctx.config.webOrigin, credentials: true });

  app.decorateRequest('actor', null);
  app.decorateRequest('subject', null);

  app.addHook('onRequest', async (req, reply) => {
    req.actor = null;
    req.subject = null;
    const header = req.headers.authorization ?? '';
    if (ctx.config.nodeEnv === 'test' && header.startsWith('Test ')) {
      // Test seam for the integration suite: no network, no Clerk. Never active outside NODE_ENV=test.
      const userId = header.slice(5).trim();
      const [user] = await ctx.db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (user) {
        req.subject = user.authSubject ?? `test:${user.id}`;
        req.actor = await buildActor(ctx.db, user);
      }
    } else if (header.startsWith('Bearer ')) {
      const identity = await ctx.auth.verify(header.slice(7).trim());
      if (identity) {
        req.subject = identity.subject;
        let user = await userBySubject(ctx.db, identity.subject);
        if (!user) user = await provisionFromInvitation(ctx.db, ctx.auth, identity.subject);
        if (user) req.actor = await buildActor(ctx.db, user);
      }
    }
    const url = req.url.split('?')[0]!;
    if (PUBLIC.some((p) => url.startsWith(p))) return;
    if (IDENTITY_ONLY.some((p) => url.startsWith(p))) {
      if (!req.subject) {
        reply.code(401).send({ error: 'Not signed in' });
        return reply;
      }
      return;
    }
    if (url.startsWith('/api/') && !req.actor) {
      reply.code(req.subject ? 403 : 401).send({ error: req.subject ? 'Your account is not provisioned in a workspace yet' : 'Not signed in', code: req.subject ? 'not_provisioned' : 'unauthenticated' });
      return reply;
    }
  });

  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message, details: err.details ?? null });
    if (err instanceof ZodError) return reply.code(400).send({ error: 'Validation failed', details: err.issues });
    const e = err as Error & { validation?: unknown; statusCode?: number };
    if (e.validation) return reply.code(400).send({ error: e.message });
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: e.message });
    req.log.error({ err: { message: e.message, name: e.name, stack: e.stack } }, 'unhandled');
    return reply.code(500).send({ error: 'Internal error' });
  });

  app.get('/health', async () => ({ ok: true, posture: ctx.config.deploymentPosture, provider: ctx.gate.providerName, model: ctx.aiConfig.model, jobs: ctx.queue.driver }));

  registerAuthRoutes(app, ctx);
  registerCaseRoutes(app, ctx);
  registerPlanRoutes(app, ctx);
  registerSignalRoutes(app, ctx);
  registerPatternRoutes(app, ctx);
  registerReviewRoutes(app, ctx);
  registerAdminRoutes(app, ctx);
  registerPiiRoutes(app, ctx);
  return app;
}
