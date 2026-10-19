import { randomUUID } from "node:crypto";
import { chunkText, type EmbeddingProvider, toPgVector } from "@ravi/ai-engine";
import type { PrismaClient } from "@ravi/db";

export const CHUNK_OPTIONS = { maxChars: 1500, overlapChars: 200 };
export const MAX_CHUNKS_PER_DOCUMENT = 300;

export class IndexingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IndexingError";
  }
}

/**
 * Chunks a document, embeds every chunk and stores the vectors in pgvector.
 * Chunks are derived data: re-indexing replaces only this document's previous chunks, in one
 * transaction, after all embeddings succeeded. The document itself is never deleted.
 * The caller must have checked tenancy, permissions and assertAiAllowed().
 */
export async function indexKnowledgeDocument(
  prisma: PrismaClient,
  embeddings: EmbeddingProvider,
  input: { organizationId: string; documentId: string },
): Promise<{ chunks: number }> {
  const doc = await prisma.knowledgeDocument.findFirst({
    where: { id: input.documentId, organizationId: input.organizationId },
    select: { id: true, title: true, content: true, status: true },
  });
  if (!doc) throw new IndexingError("Document not found");
  if (doc.status === "ARCHIVED") throw new IndexingError("Archived documents cannot be indexed");
  if (!doc.content?.trim()) throw new IndexingError("The document has no text to index");

  const chunks = chunkText(doc.content, CHUNK_OPTIONS);
  if (chunks.length === 0) throw new IndexingError("The document has no text to index");
  if (chunks.length > MAX_CHUNKS_PER_DOCUMENT) {
    throw new IndexingError(`Documents may produce at most ${MAX_CHUNKS_PER_DOCUMENT} chunks`);
  }

  await prisma.knowledgeDocument.updateMany({
    where: { id: doc.id, organizationId: input.organizationId },
    data: { status: "PROCESSING", errorMessage: null },
  });

  try {
    const vectors: number[][] = [];
    for (let i = 0; i < chunks.length; i += embeddings.maxBatchSize) {
      const batch = chunks.slice(i, i + embeddings.maxBatchSize);
      const result = await embeddings.embed(
        batch.map((c) => ({ text: c.content, title: doc.title })),
        "document",
      );
      vectors.push(...result.vectors);
    }

    await prisma.$transaction(async (tx) => {
      await tx.knowledgeChunk.deleteMany({
        where: { documentId: doc.id, organizationId: input.organizationId },
      });
      for (const [i, chunk] of chunks.entries()) {
        await tx.$executeRaw`
          INSERT INTO "KnowledgeChunk"
            (id, "organizationId", "documentId", index, content, "tokenEstimate", embedding, "embeddingModel", "createdAt")
          VALUES
            (${randomUUID()}, ${input.organizationId}, ${doc.id}, ${chunk.index}, ${chunk.content},
             ${chunk.tokenEstimate}, ${toPgVector(vectors[i]!)}::vector, ${embeddings.model}, now())`;
      }
      await tx.knowledgeDocument.update({
        where: { id: doc.id },
        data: {
          status: "READY",
          indexedAt: new Date(),
          embeddingModel: embeddings.model,
          errorMessage: null,
        },
      });
    });
    return { chunks: chunks.length };
  } catch (err) {
    const status = (err as { status?: unknown })?.status;
    await prisma.knowledgeDocument.updateMany({
      where: { id: doc.id, organizationId: input.organizationId },
      data: {
        status: "FAILED",
        errorMessage:
          err instanceof IndexingError
            ? err.message
            : typeof status === "number"
              ? `AI provider error (HTTP ${status})`
              : "Indexing failed",
      },
    });
    throw err;
  }
}
