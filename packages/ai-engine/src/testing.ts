/**
 * Test doubles for automated tests. Deterministic, offline, free. Never used in production code
 * paths (import from "@ravi/ai-engine/testing").
 */
import { createHash } from "node:crypto";
import { tokenize } from "./rag/retriever";
import type {
  EmbeddingKind,
  EmbeddingProvider,
  EmbedInput,
  EmbedResult,
  GenerateParams,
  GenerateResult,
  LLMProvider,
} from "./types";

/**
 * Hashed bag-of-words embeddings: texts that share words get similar vectors, so retrieval
 * behaves meaningfully in tests without calling an API.
 */
export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly name = "fake";
  readonly model = "fake-embedding";
  readonly maxBatchSize = 32;
  readonly calls: { inputs: EmbedInput[]; kind: EmbeddingKind }[] = [];

  constructor(readonly dimensions = 768) {}

  vector(text: string): number[] {
    const v = new Array<number>(this.dimensions).fill(0);
    for (const token of tokenize(text)) {
      const h = createHash("sha256").update(token).digest();
      v[h.readUInt32BE(0) % this.dimensions]! += 1;
      v[h.readUInt32BE(4) % this.dimensions]! += 0.5;
    }
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    return v.map((x) => x / norm);
  }

  async embed(inputs: EmbedInput[], kind: EmbeddingKind): Promise<EmbedResult> {
    this.calls.push({ inputs, kind });
    return {
      vectors: inputs.map((i) => this.vector(`${i.title ?? ""} ${i.text}`)),
      model: this.model,
      dimensions: this.dimensions,
      inputTokens: inputs.reduce((n, i) => n + Math.ceil(i.text.length / 4), 0),
    };
  }
}

/** Chat model double that returns queued responses and records every request. */
export class ScriptedChatProvider implements LLMProvider {
  readonly name = "scripted";
  readonly requests: GenerateParams[] = [];
  private readonly queue: (Partial<GenerateResult> | Error)[] = [];
  /** Simulated latency, so concurrent calls genuinely overlap in tests. */
  delayMs = 0;

  constructor(readonly model = "scripted-model") {}

  /** Queue a structured answer (serialised as the JSON the real model returns). */
  answer(answer: {
    answer: string;
    handoff?: boolean;
    handoffReason?: string;
    sourceIds?: number[];
    language?: string;
  }): this {
    this.queue.push({
      text: JSON.stringify({
        handoff: false,
        handoffReason: "none",
        sourceIds: [1],
        language: "english",
        ...answer,
      }),
    });
    return this;
  }

  respond(result: Partial<GenerateResult> | Error): this {
    this.queue.push(result);
    return this;
  }

  async generate(params: GenerateParams): Promise<GenerateResult> {
    this.requests.push(params);
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    const next = this.queue.shift();
    if (next instanceof Error) throw next;
    return {
      text: "",
      refused: false,
      stopReason: "STOP",
      model: this.model,
      usage: { inputTokens: 1000, outputTokens: 100, thinkingTokens: 0 },
      ...next,
    };
  }
}
