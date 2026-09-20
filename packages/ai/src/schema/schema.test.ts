import { describe, expect, it } from 'vitest';
import { InterventionProposal, PlanContent, ReviewNarrative } from '@class-pulse/domain';
import { ClassifierOutput, JudgeOutput, toStructuredJsonSchema } from './index';

function walk(node: unknown, visit: (o: Record<string, unknown>, path: string) => void, path = '$') {
  if (Array.isArray(node)) node.forEach((n, i) => walk(n, visit, `${path}[${i}]`));
  else if (node && typeof node === 'object') {
    visit(node as Record<string, unknown>, path);
    for (const [k, v] of Object.entries(node)) walk(v, visit, `${path}.${k}`);
  }
}

describe('structured-output JSON schema', () => {
  for (const [name, schema] of Object.entries({ PlanContent, InterventionProposal, ReviewNarrative, ClassifierOutput, JudgeOutput })) {
    it(`${name} is strict-mode compatible`, () => {
      const js = toStructuredJsonSchema(schema);
      expect(js.type).toBe('object');
      walk(js, (o, path) => {
        if (o.type === 'object' && o.properties) {
          expect(o.additionalProperties, path).toBe(false);
          expect(o.required, path).toEqual(Object.keys(o.properties as object));
        }
        for (const k of ['minLength', 'maxLength', 'minimum', 'maximum', 'pattern', 'format', 'const', 'minItems']) {
          expect(k in o, `${path} has ${k}`).toBe(false);
        }
      });
    });
  }
  it('renders discriminated unions as anyOf with enum discriminators', () => {
    const js = toStructuredJsonSchema(PlanContent) as any;
    const baseline = js.properties.measurableGoals.items.properties.baseline;
    expect(Array.isArray(baseline.anyOf)).toBe(true);
    expect(baseline.anyOf[0].properties.status.enum).toEqual(['available']);
  });
});
