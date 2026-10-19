import {
  type EmbeddingProvider,
  type KnowledgeChunkRef,
  reciprocalRankFusion,
  type Retriever,
  tokenize,
  toPgVector,
} from "@ravi/ai-engine";
import type { PrismaClient } from "@ravi/db";

export interface HybridRetrieverOptions {
  /** Minimum cosine similarity for a vector hit to count (tune with `pnpm ai:eval`). */
  minSimilarity?: number;
  /** Candidates fetched per method before fusion. */
  candidates?: number;
}

/**
 * Organization-scoped hybrid retrieval over READY documents:
 *  - semantic: pgvector cosine distance on Gemini embeddings (threshold-filtered);
 *  - lexical: PostgreSQL full-text search ('simple' config, works for English, Urdu, Roman Urdu);
 *  - fused with reciprocal-rank fusion.
 * Every query filters chunk AND document by organizationId; there is no cross-tenant path.
 */
export class PgHybridRetriever implements Retriever {
  private readonly minSimilarity: number;
  private readonly candidates: number;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly embeddings: EmbeddingProvider,
    options: HybridRetrieverOptions = {},
  ) {
    this.minSimilarity = options.minSimilarity ?? 0.55;
    this.candidates = options.candidates ?? 20;
  }

  async retrieve({
    organizationId,
    query,
    limit,
  }: {
    organizationId: string;
    query: string;
    limit: number;
  }): Promise<KnowledgeChunkRef[]> {
    const trimmed = query.trim().slice(0, 2000);
    if (!trimmed) return [];

    const [queryVector] = (await this.embeddings.embed([{ text: trimmed }], "query")).vectors;
    const vector = toPgVector(queryVector!);

    type Row = {
      id: string;
      documentId: string;
      documentTitle: string;
      content: string;
      similarity: number;
    };
    const vectorRows = await this.prisma.$queryRaw<Row[]>`
      SELECT c.id, c."documentId", d.title AS "documentTitle", c.content,
             (1 - (c.embedding <=> ${vector}::vector))::float8 AS similarity
      FROM "KnowledgeChunk" c
      JOIN "KnowledgeDocument" d ON d.id = c."documentId"
      WHERE c."organizationId" = ${organizationId}
        AND d."organizationId" = ${organizationId}
        AND d.status = 'READY'::"KnowledgeDocumentStatus"
        AND c.embedding IS NOT NULL
        AND c."embeddingModel" = ${this.embeddings.model}
      ORDER BY c.embedding <=> ${vector}::vector
      LIMIT ${this.candidates}`;

    // tokenize() keeps only letters and digits, so the tsquery cannot contain operators.
    const terms = [...new Set(tokenize(trimmed))].slice(0, 32);
    const textRows = terms.length
      ? await this.prisma.$queryRaw<Omit<Row, "similarity">[]>`
          SELECT c.id, c."documentId", d.title AS "documentTitle", c.content
          FROM "KnowledgeChunk" c
          JOIN "KnowledgeDocument" d ON d.id = c."documentId",
               to_tsquery('simple', ${terms.join(" | ")}) q
          WHERE c."organizationId" = ${organizationId}
            AND d."organizationId" = ${organizationId}
            AND d.status = 'READY'::"KnowledgeDocumentStatus"
            AND to_tsvector('simple', c.content) @@ q
          ORDER BY ts_rank_cd(to_tsvector('simple', c.content), q) DESC
          LIMIT ${this.candidates}`
      : [];

    const relevantVector = vectorRows.filter((r) => Number(r.similarity) >= this.minSimilarity);
    const similarity = new Map(vectorRows.map((r) => [r.id, Number(r.similarity)]));
    const byId = new Map<string, Omit<Row, "similarity">>(
      [...textRows, ...relevantVector].map((r) => [r.id, r]),
    );

    // A lexical-only hit must still be somewhat related semantically (avoids stop-word noise).
    const lexical = textRows
      .map((r) => r.id)
      .filter((id) => (similarity.get(id) ?? this.minSimilarity) >= this.minSimilarity * 0.8);
    const fused = reciprocalRankFusion([relevantVector.map((r) => r.id), lexical]);

    return [...fused.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id, score]) => {
        const row = byId.get(id)!;
        return {
          id,
          documentId: row.documentId,
          documentTitle: row.documentTitle,
          content: row.content,
          score,
          similarity: similarity.get(id),
        };
      });
  }
}
