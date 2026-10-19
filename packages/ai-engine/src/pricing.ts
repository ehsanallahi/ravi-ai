/**
 * Gemini Developer API standard (paid-tier) prices in USD per 1M tokens.
 * Source: https://ai.google.dev/gemini-api/docs/pricing (verified 2026-10-19).
 * Prices change; re-verify before relying on cost reports, or override with
 * GEMINI_CHAT_PRICE_*_PER_MTOK / GEMINI_EMBEDDING_PRICE_PER_MTOK.
 */
interface ChatPrice {
  inputPerMTok: number;
  outputPerMTok: number;
  /** Prices that change on a date (ISO, inclusive start). */
  from?: string;
}

const CHAT_PRICES: Record<string, ChatPrice[]> = {
  "gemini-3.1-flash-lite": [{ inputPerMTok: 0.25, outputPerMTok: 1.5 }],
  "gemini-3.5-flash-lite": [{ inputPerMTok: 0.3, outputPerMTok: 2.5 }],
  "gemini-2.5-flash-lite": [{ inputPerMTok: 0.1, outputPerMTok: 0.4 }],
  "gemini-2.5-flash": [{ inputPerMTok: 0.3, outputPerMTok: 2.5 }],
  "gemini-3-flash-preview": [{ inputPerMTok: 0.5, outputPerMTok: 3.0 }],
  "gemini-3.6-flash": [
    { inputPerMTok: 0.75, outputPerMTok: 3.75 },
    { inputPerMTok: 1.5, outputPerMTok: 7.5, from: "2027-01-01" },
  ],
  "gemini-3.8-flash": [
    { inputPerMTok: 0.75, outputPerMTok: 3.75 },
    { inputPerMTok: 1.5, outputPerMTok: 7.5, from: "2027-01-01" },
  ],
};

/** Text input price for embedding models, USD per 1M tokens. */
const EMBEDDING_PRICES: Record<string, number> = {
  "gemini-embedding-2": 0.2,
};

export interface PriceOverrides {
  chatInputPerMTok?: number;
  chatOutputPerMTok?: number;
  embeddingPerMTok?: number;
}

export class UnknownModelPriceError extends Error {
  constructor(model: string) {
    super(
      `No price is known for model "${model}". Set the GEMINI_*_PRICE_* overrides so usage limits can be enforced.`,
    );
    this.name = "UnknownModelPriceError";
  }
}

export function chatPrice(
  model: string,
  at = new Date(),
  overrides: PriceOverrides = {},
): ChatPrice {
  if (overrides.chatInputPerMTok !== undefined && overrides.chatOutputPerMTok !== undefined) {
    return { inputPerMTok: overrides.chatInputPerMTok, outputPerMTok: overrides.chatOutputPerMTok };
  }
  const tiers = CHAT_PRICES[model];
  if (!tiers) throw new UnknownModelPriceError(model);
  const day = at.toISOString().slice(0, 10);
  return [...tiers].reverse().find((t) => !t.from || t.from <= day) ?? tiers[0]!;
}

export function embeddingPrice(model: string, overrides: PriceOverrides = {}): number {
  if (overrides.embeddingPerMTok !== undefined) return overrides.embeddingPerMTok;
  const price = EMBEDDING_PRICES[model];
  if (price === undefined) throw new UnknownModelPriceError(model);
  return price;
}

/** True when cost can be computed (a known model or explicit overrides). */
export function hasKnownChatPrice(model: string, overrides: PriceOverrides = {}): boolean {
  try {
    chatPrice(model, new Date(), overrides);
    return true;
  } catch {
    return false;
  }
}

export function estimateChatCostUsd(
  model: string,
  usage: { inputTokens: number; outputTokens: number; thinkingTokens: number },
  at = new Date(),
  overrides: PriceOverrides = {},
): number {
  const p = chatPrice(model, at, overrides);
  // Thinking tokens are billed at the output rate.
  return (
    (usage.inputTokens * p.inputPerMTok +
      (usage.outputTokens + usage.thinkingTokens) * p.outputPerMTok) /
    1_000_000
  );
}

export function estimateEmbeddingCostUsd(
  model: string,
  inputTokens: number,
  overrides: PriceOverrides = {},
): number {
  return (inputTokens * embeddingPrice(model, overrides)) / 1_000_000;
}

/** Rough token estimate when an API does not report usage (≈4 characters per token). */
export function estimateTokensFromText(text: string): number {
  return Math.ceil(text.length / 4);
}
