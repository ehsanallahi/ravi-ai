export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface GenerateParams {
  system: string;
  messages: ChatMessage[];
  maxTokens?: number;
}

export interface GenerateResult {
  text: string;
  /** True when the provider declined to answer (for example, a safety refusal). */
  refused: boolean;
  stopReason: string | null;
  model: string;
  usage?: { inputTokens: number; outputTokens: number };
}

/** Every LLM backend implements this interface. Keep it small and provider-neutral. */
export interface LLMProvider {
  readonly name: string;
  generate(params: GenerateParams): Promise<GenerateResult>;
}

export interface KnowledgeChunkRef {
  id: string;
  documentId: string;
  documentTitle: string;
  content: string;
  score: number;
}
