import { GoogleGenAI } from "@google/genai";
import type {
  ChatMessage,
  EmbeddingKind,
  EmbeddingProvider,
  EmbedInput,
  EmbedResult,
  GenerateParams,
  GenerateResult,
  LLMProvider,
} from "../types";
import { estimateTokensFromText } from "../pricing";

/**
 * The subset of the official @google/genai client that Ravi AI uses. Production passes
 * `new GoogleGenAI({ apiKey }).models`; tests pass a mock (no network, no key).
 */
export interface GeminiModelsClient {
  generateContent(params: {
    model: string;
    contents: { role: "user" | "model"; parts: { text: string }[] }[];
    config?: Record<string, unknown>;
  }): Promise<{
    text?: string;
    modelVersion?: string;
    candidates?: { finishReason?: string }[];
    promptFeedback?: { blockReason?: string };
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      thoughtsTokenCount?: number;
    };
  }>;
  embedContent(params: {
    model: string;
    /** One Content per input. (A plain string[] is merged into ONE embedding for gemini-embedding-2.) */
    contents: { parts: { text: string }[] }[];
    config?: Record<string, unknown>;
  }): Promise<{ embeddings?: { values?: number[] }[] }>;
}

export function createGeminiModelsClient(apiKey: string): GeminiModelsClient {
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  // Server-side only. The key never leaves the server process.
  return new GoogleGenAI({ apiKey }).models as unknown as GeminiModelsClient;
}

export type GeminiThinkingLevel = "minimal" | "low" | "medium" | "high";

/** Finish/block reasons that mean the model declined or was stopped by a safety filter. */
const BLOCKED_REASONS = new Set([
  "SAFETY",
  "PROHIBITED_CONTENT",
  "BLOCKLIST",
  "SPII",
  "RECITATION",
  "IMAGE_SAFETY",
]);

function toContents(messages: ChatMessage[]) {
  return messages.map((m) => ({
    role: m.role === "assistant" ? ("model" as const) : ("user" as const),
    parts: [{ text: m.content }],
  }));
}

export interface GeminiChatOptions {
  client: GeminiModelsClient;
  model: string;
  /** Only sent to Gemini 3.x models, which accept thinkingLevel. Lower = faster and cheaper. */
  thinkingLevel?: GeminiThinkingLevel;
}

export class GeminiChatProvider implements LLMProvider {
  readonly name = "gemini";
  readonly model: string;
  private readonly client: GeminiModelsClient;
  private readonly thinkingLevel?: GeminiThinkingLevel;

  constructor(options: GeminiChatOptions) {
    this.client = options.client;
    this.model = options.model;
    this.thinkingLevel = options.thinkingLevel;
  }

  async generate({
    system,
    messages,
    maxTokens = 1024,
    responseJsonSchema,
  }: GenerateParams): Promise<GenerateResult> {
    // Note: Gemini 3.6+ ignores temperature/top_p/top_k, so none are sent.
    const config: Record<string, unknown> = {
      systemInstruction: system,
      maxOutputTokens: maxTokens,
    };
    if (responseJsonSchema) {
      config.responseMimeType = "application/json";
      config.responseJsonSchema = responseJsonSchema;
    }
    if (this.thinkingLevel && this.model.startsWith("gemini-3")) {
      config.thinkingConfig = { thinkingLevel: this.thinkingLevel };
    }

    const response = await this.client.generateContent({
      model: this.model,
      contents: toContents(messages),
      config,
    });

    const finishReason = response.candidates?.[0]?.finishReason ?? null;
    const blockReason = response.promptFeedback?.blockReason ?? null;
    const refused =
      Boolean(blockReason) || (finishReason !== null && BLOCKED_REASONS.has(finishReason));
    const usage = response.usageMetadata ?? {};

    return {
      text: refused ? "" : (response.text ?? "").trim(),
      refused,
      stopReason: blockReason ?? finishReason,
      model: response.modelVersion ?? this.model,
      usage: {
        inputTokens: usage.promptTokenCount ?? 0,
        outputTokens: usage.candidatesTokenCount ?? 0,
        thinkingTokens: usage.thoughtsTokenCount ?? 0,
      },
    };
  }
}

export class EmbeddingDimensionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingDimensionError";
  }
}

/** Models that take task instructions as text prefixes instead of the taskType field. */
const PREFIX_TASK_MODELS = new Set(["gemini-embedding-2", "gemini-embedding-2-preview"]);

export interface GeminiEmbeddingOptions {
  client: GeminiModelsClient;
  model: string;
  dimensions: number;
}

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly name = "gemini";
  readonly model: string;
  readonly dimensions: number;
  readonly maxBatchSize = 32;
  private readonly client: GeminiModelsClient;

  constructor(options: GeminiEmbeddingOptions) {
    if (
      !Number.isInteger(options.dimensions) ||
      options.dimensions < 128 ||
      options.dimensions > 3072
    ) {
      throw new EmbeddingDimensionError(
        `Embedding dimensions must be an integer between 128 and 3072 (got ${options.dimensions})`,
      );
    }
    this.client = options.client;
    this.model = options.model;
    this.dimensions = options.dimensions;
  }

  /** Task formatting per Google's guidance for retrieval with gemini-embedding-2. */
  format(input: EmbedInput, kind: EmbeddingKind): string {
    if (!PREFIX_TASK_MODELS.has(this.model)) return input.text;
    return kind === "query"
      ? `task: search result | query: ${input.text}`
      : `title: ${input.title?.trim() || "none"} | text: ${input.text}`;
  }

  async embed(inputs: EmbedInput[], kind: EmbeddingKind): Promise<EmbedResult> {
    if (inputs.length === 0)
      return { vectors: [], model: this.model, dimensions: this.dimensions, inputTokens: 0 };
    if (inputs.length > this.maxBatchSize) {
      throw new Error(`At most ${this.maxBatchSize} inputs per embedding request`);
    }
    const texts = inputs.map((i) => this.format(i, kind));
    // One Content object per input. With @google/genai, a string[] for gemini-embedding-2 becomes
    // the parts of a single content (one combined embedding); Content[] yields one embedding each.
    const contents = texts.map((text) => ({ parts: [{ text }] }));
    const config: Record<string, unknown> = { outputDimensionality: this.dimensions };
    if (!PREFIX_TASK_MODELS.has(this.model)) {
      config.taskType = kind === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT";
    }

    const response = await this.client.embedContent({ model: this.model, contents, config });
    const vectors = (response.embeddings ?? []).map((e) => e.values ?? []);
    if (vectors.length !== inputs.length) {
      throw new EmbeddingDimensionError(
        `Expected ${inputs.length} embeddings, received ${vectors.length}`,
      );
    }
    for (const v of vectors) {
      if (v.length !== this.dimensions) {
        throw new EmbeddingDimensionError(
          `Model ${this.model} returned ${v.length} dimensions; configured ${this.dimensions}`,
        );
      }
      if (!v.every(Number.isFinite))
        throw new EmbeddingDimensionError("Embedding contains non-finite values");
    }

    return {
      vectors,
      model: this.model,
      dimensions: this.dimensions,
      inputTokens: texts.reduce((n, c) => n + estimateTokensFromText(c), 0),
    };
  }
}
