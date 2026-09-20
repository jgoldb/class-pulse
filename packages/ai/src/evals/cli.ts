/**
 * `npm run evals` — run the plan-generation eval suite against the configured provider and write
 * a JSON report. Exit code 1 on failure so CI can gate prompt promotion (docs/03, docs/06 Phase 1).
 *
 * Env: AI_PROVIDER=mock|openai (+ OPENAI_* as in .env.example). EVAL_JUDGE=false skips the judge.
 * EVAL_CASES=001,004 limits the run.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { aiConfigFromEnv, modelResolverFromConfig, providerFromEnv } from '../egress';
import { seedPromptFor } from '../prompts';
import { EVAL_CASES } from './cases';
import { formatReport, runEvals } from './runner';

async function main() {
  const cfg = aiConfigFromEnv();
  const provider = providerFromEnv();
  const only = process.env.EVAL_CASES?.split(',').map((s) => s.trim()).filter(Boolean);
  const cases = only?.length ? EVAL_CASES.filter((c) => only.includes(c.id)) : EVAL_CASES;
  // EVAL_PROMPT_VERSION=2 evaluates a specific registry seed (e.g. a draft version before promotion).
  const version = process.env.EVAL_PROMPT_VERSION ? Number(process.env.EVAL_PROMPT_VERSION) : undefined;
  const report = await runEvals({
    provider,
    resolveModel: modelResolverFromConfig(cfg),
    posture: cfg.posture,
    cases,
    planPrompt: seedPromptFor('plan_generation', version),
    judge: process.env.EVAL_JUDGE !== 'false',
  });
  const dir = join(process.cwd(), 'eval-reports');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${report.promptVersionId}.${report.provider}.${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(formatReport(report));
  console.log(`Report written to ${file}`);
  process.exit(report.passed ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
