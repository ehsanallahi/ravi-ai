import {
  type AiProviders,
  createAiProviders,
  estimateChatCostUsd,
  estimateEmbeddingCostUsd,
  estimateTokensFromText,
  type EmbeddingProvider,
  type GeminiModelsClient,
  hasKnownChatPrice,
  type LLMProvider,
  type PriceOverrides,
} from "@ravi/ai-engine";
import { KNOWLEDGE_EMBEDDING_DIMENSIONS } from "@ravi/db";
import { type AiEnv, isAiConfigured } from "@ravi/validation";

export class AiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiConfigError";
  }
}

export interface AiRuntime {
  configured: boolean;
  chat: LLMProvider;
  embeddings: EmbeddingProvider;
  prices: PriceOverrides;
  limits: { monthlyBudgetUsd: number; requestsPerHour: number };
  retrieval: { minSimilarity: number };
  models: { chat: string; embedding: string; dimensions: number };
}

export function priceOverrides(env: AiEnv): PriceOverrides {
  return {
    chatInputPerMTok: env.GEMINI_CHAT_PRICE_INPUT_PER_MTOK,
    chatOutputPerMTok: env.GEMINI_CHAT_PRICE_OUTPUT_PER_MTOK,
    embeddingPerMTok: env.GEMINI_EMBEDDING_PRICE_PER_MTOK,
  };
}

/**
 * Validates AI configuration and builds the providers. Fails fast on configurations that would
 * produce unusable vectors or unenforceable budgets:
 * - embedding dimensions must match the pgvector column (KnowledgeChunk.embedding);
 * - the chat model must have a known price (or explicit price overrides).
 */
export function createAiRuntime(
  env: AiEnv,
  options: {
    client?: GeminiModelsClient;
    providers?: Pick<AiProviders, "chat" | "embeddings">;
  } = {},
): AiRuntime {
  if (env.GEMINI_EMBEDDING_DIMENSIONS !== KNOWLEDGE_EMBEDDING_DIMENSIONS) {
    throw new AiConfigError(
      `GEMINI_EMBEDDING_DIMENSIONS=${env.GEMINI_EMBEDDING_DIMENSIONS} does not match the database vector column (${KNOWLEDGE_EMBEDDING_DIMENSIONS}). Changing it needs a migration and a full re-index.`,
    );
  }
  const prices = priceOverrides(env);
  if (!hasKnownChatPrice(env.GEMINI_CHAT_MODEL, prices)) {
    throw new AiConfigError(
      `No price is known for GEMINI_CHAT_MODEL=${env.GEMINI_CHAT_MODEL}. Set GEMINI_CHAT_PRICE_INPUT_PER_MTOK and GEMINI_CHAT_PRICE_OUTPUT_PER_MTOK.`,
    );
  }

  const configured = Boolean(options.providers) || isAiConfigured(env);
  const providers =
    options.providers ??
    createAiProviders(
      configured
        ? {
            provider: "gemini",
            apiKey: env.GEMINI_API_KEY ?? "",
            chatModel: env.GEMINI_CHAT_MODEL,
            embeddingModel: env.GEMINI_EMBEDDING_MODEL,
            embeddingDimensions: env.GEMINI_EMBEDDING_DIMENSIONS,
            thinkingLevel: env.GEMINI_THINKING_LEVEL,
            timeoutMs: env.GEMINI_TIMEOUT_MS,
            maxAttempts: env.GEMINI_MAX_ATTEMPTS,
            client: options.client,
          }
        : { provider: "disabled" },
    );

  return {
    configured,
    chat: providers.chat,
    embeddings: providers.embeddings,
    prices,
    limits: {
      monthlyBudgetUsd: env.AI_MONTHLY_BUDGET_USD,
      requestsPerHour: env.AI_ORG_REQUESTS_PER_HOUR,
    },
    retrieval: { minSimilarity: env.AI_RETRIEVAL_MIN_SIMILARITY },
    models: {
      chat: env.GEMINI_CHAT_MODEL,
      embedding: env.GEMINI_EMBEDDING_MODEL,
      dimensions: env.GEMINI_EMBEDDING_DIMENSIONS,
    },
  };
}

/** Upper bounds for one assistant answer (system prompt + up to 5 sources + question). */
export const ASSISTANT_MAX_INPUT_TOKENS = 8_000;
export const ASSISTANT_MAX_OUTPUT_TOKENS = 1_024;
export const ASSISTANT_MAX_THINKING_TOKENS = 1_024;

/** Conservative cost of one assistant answer, reserved before the call. */
export function estimateAssistantCostUsd(runtime: AiRuntime): number {
  const chat = estimateChatCostUsd(
    runtime.models.chat,
    {
      inputTokens: ASSISTANT_MAX_INPUT_TOKENS,
      outputTokens: ASSISTANT_MAX_OUTPUT_TOKENS,
      thinkingTokens: ASSISTANT_MAX_THINKING_TOKENS,
    },
    new Date(),
    runtime.prices,
  );
  const query = estimateEmbeddingCostUsd(runtime.models.embedding, 600, runtime.prices);
  return chat + query;
}

/** Conservative cost of embedding a document (chunk overlap and task prefixes add ~25%). */
export function estimateIndexingCostUsd(runtime: AiRuntime, text: string): number {
  const tokens = Math.ceil(estimateTokensFromText(text) * 1.25) + 50;
  return estimateEmbeddingCostUsd(runtime.models.embedding, tokens, runtime.prices);
}
