import type { EmbeddingProvider, KnowledgeChunkRef } from "../types";
import type { Retriever } from "./retriever";

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0)
    throw new Error("Vectors must have the same, non-zero length");
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** pgvector text literal, e.g. "[0.1,0.2]". Rejects non-finite values. */
export function toPgVector(values: number[]): string {
  if (!values.every(Number.isFinite)) throw new Error("Vector contains non-finite values");
  return `[${values.join(",")}]`;
}

/** Reciprocal-rank fusion of several ranked ID lists (k = 60, the common default). */
export function reciprocalRankFusion(rankings: string[][], k = 60): Map<string, number> {
  const scores = new Map<string, number>();
  for (const ranking of rankings) {
    ranking.forEach((id, rank) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1)));
  }
  return scores;
}

export interface EmbeddedChunk extends Omit<KnowledgeChunkRef, "score" | "similarity"> {
  organizationId: string;
  embedding: number[];
}

/**
 * In-memory vector retriever for evaluations and tests. Production uses PostgreSQL + pgvector
 * (see @ravi/knowledge). Always tenant-scoped.
 */
export class InMemoryVectorRetriever implements Retriever {
  constructor(
    private readonly chunks: EmbeddedChunk[],
    private readonly embeddings: EmbeddingProvider,
    private readonly minSimilarity = 0.5,
  ) {}

  async retrieve({
    organizationId,
    query,
    limit,
  }: {
    organizationId: string;
    query: string;
    limit: number;
  }) {
    const [queryVector] = (await this.embeddings.embed([{ text: query }], "query")).vectors;
    return this.chunks
      .filter((c) => c.organizationId === organizationId)
      .map(({ embedding, organizationId: _org, ...c }) => {
        const similarity = cosineSimilarity(queryVector!, embedding);
        return { ...c, score: similarity, similarity };
      })
      .filter((c) => c.similarity >= this.minSimilarity)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}
