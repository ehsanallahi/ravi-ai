import type { EmbeddingProvider, LLMProvider } from "../types";
import { DisabledEmbeddingProvider, DisabledProvider, ProviderDisabledError } from "./disabled";
import {
  createGeminiModelsClient,
  GeminiChatProvider,
  GeminiEmbeddingProvider,
  type GeminiModelsClient,
  type GeminiThinkingLevel,
} from "./gemini";

export { DisabledEmbeddingProvider, DisabledProvider, ProviderDisabledError } from "./disabled";
export {
  createGeminiModelsClient,
  type GeminiClientOptions,
  RETRYABLE_STATUS_CODES,
  EmbeddingDimensionError,
  GeminiChatProvider,
  GeminiEmbeddingProvider,
  type GeminiModelsClient,
  type GeminiThinkingLevel,
} from "./gemini";

export type AiProviderConfig =
  | { provider: "disabled" }
  | {
      provider: "gemini";
      apiKey: string;
      chatModel: string;
      embeddingModel: string;
      embeddingDimensions: number;
      thinkingLevel?: GeminiThinkingLevel;
      timeoutMs?: number;
      maxAttempts?: number;
      /** Inject a mock in tests. */
      client?: GeminiModelsClient;
    };

export interface AiProviders {
  chat: LLMProvider;
  embeddings: EmbeddingProvider;
  enabled: boolean;
}

/**
 * Builds the configured providers. Gemini is the only implemented provider; the interfaces stay
 * provider-neutral so others can be added later. "disabled" fails closed.
 */
export function createAiProviders(config: AiProviderConfig): AiProviders {
  if (config.provider === "disabled") {
    return {
      chat: new DisabledProvider(),
      embeddings: new DisabledEmbeddingProvider(),
      enabled: false,
    };
  }
  const client =
    config.client ??
    createGeminiModelsClient(config.apiKey, {
      timeoutMs: config.timeoutMs,
      maxAttempts: config.maxAttempts,
    });
  return {
    chat: new GeminiChatProvider({
      client,
      model: config.chatModel,
      thinkingLevel: config.thinkingLevel,
    }),
    embeddings: new GeminiEmbeddingProvider({
      client,
      model: config.embeddingModel,
      dimensions: config.embeddingDimensions,
    }),
    enabled: true,
  };
}

/** HTTP status from provider errors (the Gen AI SDK's ApiError carries `status`). */
export function providerErrorStatus(err: unknown): number | null {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : null;
}

/** True for transient failures (rate limits, overload, network) that are worth retrying. */
export function isRetryableProviderError(err: unknown): boolean {
  if (err instanceof ProviderDisabledError) return false;
  const status = providerErrorStatus(err);
  if (status === null) return true; // network/timeout
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

/** True when the request was aborted by the per-attempt timeout. */
export function isProviderTimeout(err: unknown): boolean {
  const name = (err as { name?: unknown } | null)?.name;
  return name === "AbortError" || name === "TimeoutError";
}

/** A short, non-sensitive error code for usage logs (never the message, which may echo input). */
export function providerErrorCode(err: unknown): string {
  if (err instanceof ProviderDisabledError) return "provider_disabled";
  if (isProviderTimeout(err)) return "timeout";
  const status = providerErrorStatus(err);
  if (status !== null) return `http_${status}`;
  return err instanceof Error ? err.name : "unknown";
}
