import type { Role, RoleAssignment } from '@class-pulse/domain';
import type { AiConfig, EgressGate, ModelProvider } from '@class-pulse/ai';
import type { Scope } from '@class-pulse/policy';
import type { AppConfig } from './config';
import type { Db } from './db/client';
import type { JobQueue } from './jobs/queue';
import type { ClerkAuth } from './auth/clerk';

export interface AppContext {
  config: AppConfig;
  db: Db;
  auth: ClerkAuth;
  gate: EgressGate;
  aiConfig: AiConfig;
  provider: ModelProvider;
  queue: JobQueue;
  now(): Date;
  log: { info(o: unknown, msg?: string): void; warn(o: unknown, msg?: string): void; error(o: unknown, msg?: string): void };
}

/** The authenticated caller with their resolved row scope (docs/04 layer 1). */
export interface Actor {
  userId: string;
  email: string;
  displayName: string;
  assignments: RoleAssignment[];
  roles: Set<Role>;
  scope: Scope;
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const notFound = (what = 'Not found') => new HttpError(404, what);
export const forbidden = (why = 'Forbidden') => new HttpError(403, why);
export const badRequest = (why: string, details?: unknown) => new HttpError(400, why, details);
export const conflict = (why: string) => new HttpError(409, why);
