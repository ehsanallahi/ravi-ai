import type { KnowledgeChunkRef } from "../types";

/** Retrieval is tenant-scoped: implementations must only return chunks of `organizationId`. */
export interface Retriever {
  retrieve(params: {
    organizationId: string;
    query: string;
    limit: number;
  }): Promise<KnowledgeChunkRef[]>;
}

const STOPWORDS = new Set(
  "a an and are as at be but by can do does for from have how i in is it me my of on or our please so that the this to was we what when where which who why will with you your".split(
    " ",
  ),
);

export function tokenize(text: string): string[] {
  return (
    text
      .toLowerCase()
      .normalize("NFKC")
      .match(/[\p{L}\p{N}]+/gu) ?? []
  ).filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/**
 * Simple in-memory keyword ranking (term overlap weighted by inverse chunk frequency).
 * Useful for tests and small knowledge bases; production uses Postgres full-text or vectors.
 */
export function rankChunksByKeywords(
  query: string,
  chunks: Omit<KnowledgeChunkRef, "score">[],
  limit: number,
): KnowledgeChunkRef[] {
  const queryTerms = new Set(tokenize(query));
  if (queryTerms.size === 0) return [];

  const chunkTerms = chunks.map((c) => new Set(tokenize(`${c.documentTitle} ${c.content}`)));
  const df = new Map<string, number>();
  for (const terms of chunkTerms)
    for (const t of terms) if (queryTerms.has(t)) df.set(t, (df.get(t) ?? 0) + 1);

  return chunks
    .map((chunk, i) => {
      let score = 0;
      for (const t of queryTerms) {
        if (chunkTerms[i]!.has(t)) score += Math.log(1 + chunks.length / (df.get(t) ?? 1));
      }
      return { ...chunk, score };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export class InMemoryRetriever implements Retriever {
  constructor(private readonly chunksByOrg: Map<string, Omit<KnowledgeChunkRef, "score">[]>) {}

  async retrieve({
    organizationId,
    query,
    limit,
  }: {
    organizationId: string;
    query: string;
    limit: number;
  }) {
    return rankChunksByKeywords(query, this.chunksByOrg.get(organizationId) ?? [], limit);
  }
}
