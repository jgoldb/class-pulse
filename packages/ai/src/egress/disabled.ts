/**
 * Disabled provider: the deployment-level off switch for the model (AI_PROVIDER=off).
 *
 * Unlike the mock provider, this one is honoured in every environment, including production.
 * The distinction that makes that safe: the mock fabricates plausible content and could be
 * mistaken for the model, so it is confined to NODE_ENV=test. This provider produces nothing —
 * it only refuses — so there is no state in which it can be mistaken for a real generation.
 *
 * Refusals still travel the full egress path, so every attempt writes an `egress_log` row with
 * the exact payload that *would* have been sent, its hash, the prompt version and the surface.
 * Turning the model off therefore leaves a record of what was asked of it, not a blind spot.
 *
 * The error is non-retryable: `generateWithGuardrails` gives up after one attempt rather than
 * burning a second call on a provider that is off by configuration and will not come back
 * within the request.
 */
import { ProviderError, type ModelProvider, type StructuredRequest, type StructuredResponse } from './provider';

export const DISABLED_MESSAGE = 'The model is turned off for this deployment (AI_PROVIDER=off). No request was sent.';

export class DisabledProvider implements ModelProvider {
  readonly name = 'disabled';

  async complete(req: StructuredRequest): Promise<StructuredResponse> {
    throw new ProviderError(`${DISABLED_MESSAGE} Surface: ${req.surface}.`, false);
  }
}
