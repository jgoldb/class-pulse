/**
 * THE ONLY FILE IN THE REPOSITORY THAT IMPORTS THE PROVIDER SDK (docs/04, docs/05).
 * eslint `no-restricted-imports` and egress.test.ts both enforce this.
 */
import OpenAI from 'openai';
import { ProviderError, type ModelProvider, type StructuredRequest, type StructuredResponse } from './provider';

export interface OpenAIProviderConfig {
  apiKey: string;
  baseURL?: string | null;
  /** Provider posture, recorded on the egress log. `store: false` is always sent (zero retention). */
  zeroRetention: boolean;
  region: string;
  timeoutMs?: number;
}

export class OpenAIProvider implements ModelProvider {
  readonly name = 'openai';
  private readonly client: OpenAI;

  constructor(private readonly cfg: OpenAIProviderConfig) {
    if (!cfg.apiKey) throw new Error('OPENAI_API_KEY is required when AI_PROVIDER=openai');
    this.client = new OpenAI({
      apiKey: cfg.apiKey,
      baseURL: cfg.baseURL || undefined,
      timeout: cfg.timeoutMs ?? 120_000,
      maxRetries: 2,
    });
  }

  async complete(req: StructuredRequest): Promise<StructuredResponse> {
    let res: OpenAI.Responses.Response;
    try {
      res = await this.client.responses.create({
        model: req.model,
        instructions: req.instructions,
        input: req.input,
        ...(req.reasoningEffort ? { reasoning: { effort: req.reasoningEffort } } : {}),
        max_output_tokens: req.maxOutputTokens,
        text: {
          format: { type: 'json_schema', name: req.schemaName, schema: req.jsonSchema, strict: true },
        },
        // Zero-retention posture: never persist inputs on the provider side (Responses API stores by default).
        store: false,
        metadata: { surface: req.surface, app: 'class-pulse' },
      });
    } catch (err) {
      const status = (err as { status?: number }).status;
      const retryable = status === undefined || status === 408 || status === 409 || status === 429 || status >= 500;
      throw new ProviderError(`OpenAI request failed${status ? ` (${status})` : ''}: ${(err as Error).message}`, retryable, err);
    }

    if (res.status === 'incomplete') {
      const reason = res.incomplete_details?.reason ?? 'unknown';
      throw new ProviderError(`OpenAI response incomplete: ${reason}`, reason === 'max_output_tokens', res);
    }

    for (const item of res.output ?? []) {
      if (item.type === 'message') {
        for (const part of item.content) {
          if (part.type === 'refusal') throw new ProviderError(`Model refused: ${part.refusal}`, false, res);
        }
      }
    }

    const rawText = res.output_text ?? '';
    let outputJson: unknown;
    try {
      outputJson = JSON.parse(rawText);
    } catch (err) {
      throw new ProviderError('OpenAI returned non-JSON output', true, err);
    }

    return {
      outputJson,
      rawText,
      usage: {
        input: res.usage?.input_tokens ?? 0,
        output: res.usage?.output_tokens ?? 0,
        reasoning: res.usage?.output_tokens_details?.reasoning_tokens ?? 0,
      },
      model: res.model ?? req.model,
      providerRequestId: res.id ?? null,
    };
  }

  posture() {
    return { zeroRetention: this.cfg.zeroRetention, region: this.cfg.region, store: false as const };
  }
}
