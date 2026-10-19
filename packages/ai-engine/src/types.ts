export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface GenerateParams {
  system: string;
  messages: ChatMessage[];
  maxTokens?: number;
  /** JSON Schema for structured output. When set, `text` is a JSON document matching it. */
  responseJsonSchema?: Record<string, unknown>;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** Reasoning tokens, billed as output by providers that report them separately. */
  thinkingTokens: number;
}

export interface GenerateResult {
  text: string;
  /** True when the provider declined to answer (for example, a safety block). */
  refused: boolean;
  stopReason: string | null;
  model: string;
  usage: TokenUsage;
}

/** Every chat backend implements this interface. Keep it small and provider-neutral. */
export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  generate(params: GenerateParams): Promise<GenerateResult>;
}

/** "query" for search questions, "document" for knowledge-base content being indexed. */
export type EmbeddingKind = "query" | "document";

export interface EmbedInput {
  text: string;
  /** Optional document title (improves document embeddings for some models). */
  title?: string;
}

export interface EmbedResult {
  vectors: number[][];
  model: string;
  dimensions: number;
  /** Estimated input tokens (embedding APIs may not report usage). */
  inputTokens: number;
}

/** Every embedding backend implements this interface. */
export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  readonly dimensions: number;
  /** Maximum inputs per request; callers batch accordingly. */
  readonly maxBatchSize: number;
  embed(inputs: EmbedInput[], kind: EmbeddingKind): Promise<EmbedResult>;
}

export interface KnowledgeChunkRef {
  id: string;
  documentId: string;
  documentTitle: string;
  content: string;
  /** Retrieval score (higher is better; scale depends on the retriever). */
  score: number;
  /** Cosine similarity for vector retrieval (0..1), when available. */
  similarity?: number;
}
