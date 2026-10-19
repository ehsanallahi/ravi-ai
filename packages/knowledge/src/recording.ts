import type {
  EmbeddingKind,
  EmbeddingProvider,
  EmbedInput,
  EmbedResult,
  GenerateParams,
  GenerateResult,
  LLMProvider,
  PriceOverrides,
} from "@ravi/ai-engine";
import type { AiFeature, PrismaClient } from "@ravi/db";
import { recordChatUsage, recordEmbeddingUsage } from "./usage";

export interface UsageContext {
  organizationId: string;
  userId?: string | null;
  feature: AiFeature;
}

/** Totals for one user-visible operation (e.g. a playground question). */
export class UsageTally {
  costUsd = 0;
  calls = 0;
}

/**
 * Wraps providers so every call is recorded in AiUsageEvent (model, tokens, dimensions, estimated
 * cost, latency, success or error code). Prompt and document text are never logged.
 */
export function withUsageRecording(
  prisma: PrismaClient,
  providers: { chat: LLMProvider; embeddings: EmbeddingProvider },
  ctx: UsageContext,
  prices: PriceOverrides,
  tally = new UsageTally(),
): { chat: LLMProvider; embeddings: EmbeddingProvider; tally: UsageTally } {
  const chat: LLMProvider = {
    name: providers.chat.name,
    model: providers.chat.model,
    async generate(params: GenerateParams): Promise<GenerateResult> {
      const started = Date.now();
      const base = { ...ctx, provider: providers.chat.name, model: providers.chat.model };
      try {
        const result = await providers.chat.generate(params);
        const { estimatedCostUsd } = await recordChatUsage(
          prisma,
          { ...base, latencyMs: Date.now() - started },
          result,
          prices,
        );
        tally.costUsd += estimatedCostUsd;
        tally.calls++;
        return result;
      } catch (err) {
        await recordChatUsage(
          prisma,
          { ...base, latencyMs: Date.now() - started },
          null,
          prices,
          err,
        );
        tally.calls++;
        throw err;
      }
    },
  };

  const embeddings: EmbeddingProvider = {
    name: providers.embeddings.name,
    model: providers.embeddings.model,
    dimensions: providers.embeddings.dimensions,
    maxBatchSize: providers.embeddings.maxBatchSize,
    async embed(inputs: EmbedInput[], kind: EmbeddingKind): Promise<EmbedResult> {
      const started = Date.now();
      const base = {
        ...ctx,
        provider: providers.embeddings.name,
        model: providers.embeddings.model,
      };
      try {
        const result = await providers.embeddings.embed(inputs, kind);
        tally.costUsd += await recordEmbeddingUsage(
          prisma,
          { ...base, latencyMs: Date.now() - started },
          { inputTokens: result.inputTokens, dimensions: result.dimensions },
          prices,
        );
        tally.calls++;
        return result;
      } catch (err) {
        await recordEmbeddingUsage(
          prisma,
          { ...base, latencyMs: Date.now() - started },
          { inputTokens: 0, dimensions: providers.embeddings.dimensions },
          prices,
          err,
        );
        tally.calls++;
        throw err;
      }
    },
  };

  return { chat, embeddings, tally };
}
