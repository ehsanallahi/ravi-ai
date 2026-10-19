import type { EmbeddingProvider, EmbedResult, GenerateResult, LLMProvider } from "../types";

export class ProviderDisabledError extends Error {
  constructor() {
    super("No AI provider is configured (set GEMINI_API_KEY and AI_PROVIDER=gemini)");
    this.name = "ProviderDisabledError";
  }
}

/** Fails closed, so a misconfigured deployment can never generate or send AI replies. */
export class DisabledProvider implements LLMProvider {
  readonly name = "disabled";
  readonly model = "none";

  async generate(): Promise<GenerateResult> {
    throw new ProviderDisabledError();
  }
}

export class DisabledEmbeddingProvider implements EmbeddingProvider {
  readonly name = "disabled";
  readonly model = "none";
  readonly dimensions = 0;
  readonly maxBatchSize = 1;

  async embed(): Promise<EmbedResult> {
    throw new ProviderDisabledError();
  }
}
