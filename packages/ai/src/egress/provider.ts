import type { AiSurface } from '@class-pulse/domain';

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

/** A structured-output request, fully serialized. This is exactly what leaves the building. */
export interface StructuredRequest {
  surface: AiSurface;
  model: string;
  reasoningEffort: ReasoningEffort | null;
  maxOutputTokens: number;
  /** The versioned prompt body (system/developer role). */
  instructions: string;
  /** The allowlisted payload, serialized as JSON text. */
  input: string;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
}

export interface StructuredResponse {
  outputJson: unknown;
  rawText: string;
  usage: { input: number; output: number; reasoning: number };
  model: string;
  providerRequestId: string | null;
}

export interface ModelProvider {
  readonly name: string;
  complete(req: StructuredRequest): Promise<StructuredResponse>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
