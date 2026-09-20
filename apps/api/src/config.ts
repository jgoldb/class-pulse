import type { Role } from '@class-pulse/domain';

/**
 * All runtime configuration in one place. Read once at boot. See .env.example for meaning.
 */
export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  webOrigin: string;
  deploymentPosture: 'demonstration' | 'operational';
  database: { url: string | null };
  jobs: { sweepCron: string };
  clerk: { publishableKey: string; secretKey: string } | null;
  planApproverRoles: Role[];
  patternMaxActivePerTeacher: number;
  adminMinCellSize: number;
}

const ROLES: Role[] = ['teacher', 'student', 'guardian', 'support_professional', 'administrator'];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = (env.NODE_ENV as AppConfig['nodeEnv']) || 'development';
  const posture = env.DEPLOYMENT_POSTURE === 'operational' ? 'operational' : 'demonstration';
  const approvers = (env.PLAN_APPROVER_ROLES || 'teacher,support_professional')
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is Role => ROLES.includes(s as Role));

  const databaseUrl = env.DATABASE_URL?.trim() || null;
  if (!databaseUrl && nodeEnv !== 'test') {
    throw new Error('DATABASE_URL is required (a Neon or other Postgres connection string). See .env.example.');
  }

  const publishableKey = env.CLERK_PUBLISHABLE_KEY?.trim() ?? '';
  const secretKey = env.CLERK_SECRET_KEY?.trim() ?? '';
  if ((!publishableKey || !secretKey) && nodeEnv !== 'test') {
    throw new Error('CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY are required. See .env.example.');
  }

  return {
    nodeEnv,
    port: Number(env.PORT) || 3001,
    webOrigin: env.WEB_ORIGIN || 'http://localhost:5173',
    deploymentPosture: posture,
    database: { url: databaseUrl },
    jobs: { sweepCron: env.PATTERN_SWEEP_CRON || '0 2 * * *' },
    clerk: publishableKey && secretKey ? { publishableKey, secretKey } : null,
    planApproverRoles: approvers.length ? approvers : ['teacher', 'support_professional'],
    patternMaxActivePerTeacher: Number(env.PATTERN_MAX_ACTIVE_PER_TEACHER) || 3,
    adminMinCellSize: Number(env.ADMIN_MIN_CELL_SIZE) || 10,
  };
}
