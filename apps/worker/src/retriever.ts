import { type KnowledgeChunkRef, type Retriever, tokenize } from "@ravi/ai-engine";
import type { PrismaClient } from "@ravi/db";

/**
 * Postgres full-text retrieval over READY knowledge documents of one organization.
 * Uses the language-neutral 'simple' configuration and ORs the query terms, so customer
 * questions do not need to contain every word. Phase 3 replaces this with hybrid vector search.
 */
export class PostgresFullTextRetriever implements Retriever {
  constructor(private readonly prisma: PrismaClient) {}

  async retrieve({
    organizationId,
    query,
    limit,
  }: {
    organizationId: string;
    query: string;
    limit: number;
  }): Promise<KnowledgeChunkRef[]> {
    // tokenize() keeps only letters and digits, so the tsquery string cannot contain operators.
    const terms = [...new Set(tokenize(query))].slice(0, 32);
    if (terms.length === 0) return [];
    const tsquery = terms.join(" | ");

    const rows = await this.prisma.$queryRaw<
      { id: string; documentId: string; documentTitle: string; content: string; score: number }[]
    >`
      SELECT c.id, c."documentId", d.title AS "documentTitle", c.content,
             ts_rank_cd(to_tsvector('simple', c.content), q)::float8 AS score
      FROM "KnowledgeChunk" c
      JOIN "KnowledgeDocument" d ON d.id = c."documentId",
           to_tsquery('simple', ${tsquery}) q
      WHERE c."organizationId" = ${organizationId}
        AND d."organizationId" = ${organizationId}
        AND d.status = 'READY'::"KnowledgeDocumentStatus"
        AND to_tsvector('simple', c.content) @@ q
      ORDER BY score DESC
      LIMIT ${limit}`;

    return rows.map((r) => ({ ...r, score: Number(r.score) }));
  }
}
