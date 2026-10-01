/** Synthetic classroom evals. No database access or automatic prompt promotion. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { aiConfigFromEnv, modelResolverFromConfig, providerFromEnv } from '../egress';
import { seedPromptFor } from '../prompts';
import { runClassroomEvals } from './classroom';

async function main() {
  const config = aiConfigFromEnv();
  if (config.provider === 'off') throw new Error('AI is disabled; classroom evals were not run');
  const prompt = { ...seedPromptFor('classroom_draft', process.env.EVAL_PROMPT_VERSION ? Number(process.env.EVAL_PROMPT_VERSION) : undefined), createdAt: new Date(0) };
  console.log(`Evaluating ${prompt.id} with ${config.provider}/${config.model} on synthetic fixtures`);
  const report = await runClassroomEvals({ provider: providerFromEnv(), resolveModel: modelResolverFromConfig(config), posture: config.posture, prompt });
  const directory = resolve('packages/ai/eval-reports');
  mkdirSync(directory, { recursive: true });
  const file = resolve(directory, `${prompt.id}.${report.provider}.${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(`${report.passedCases}/${report.totalCases} cases passed. Report: ${file}`);
  process.exitCode = report.passed ? 0 : 1;
}
main().catch(() => { console.error('Classroom evaluation could not complete. Check provider configuration and availability.'); process.exitCode = 1; });
