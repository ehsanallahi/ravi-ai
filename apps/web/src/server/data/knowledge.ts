import { sha256Hex } from "@ravi/core";
import { prisma } from "@ravi/db";
import {
  type AiRuntime,
  estimateIndexingCostUsd,
  FINDING_TEXT,
  scanKnowledgeContent,
  indexKnowledgeDocument,
  withAiBudget,
  withUsageRecording,
} from "@ravi/knowledge";
import { MAX_DOCUMENT_CHARS, normalizeText } from "@ravi/knowledge/extract";
import { z } from "zod";
import { writeAudit } from "../audit";
import { assertPermission, type TenantContext } from "../tenancy/context";
import { DomainError, notFoundInTenant } from "../tenancy/errors";

export const documentInputSchema = z.object({
  title: z.string().trim().min(2, "Title must be at least 2 characters").max(200),
  content: z
    .string()
    .transform(normalizeText)
    .pipe(
      z
        .string()
        .min(20, "Add at least a few sentences of business information")
        .max(
          MAX_DOCUMENT_CHARS,
          `Documents are limited to ${MAX_DOCUMENT_CHARS.toLocaleString("en")} characters`,
        ),
    ),
});

export async function listDocuments(ctx: TenantContext) {
  assertPermission(ctx, "knowledge:read");
  return prisma.knowledgeDocument.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    select: {
      id: true,
      title: true,
      status: true,
      sourceType: true,
      sourceFilename: true,
      indexedAt: true,
      updatedAt: true,
      errorMessage: true,
      _count: { select: { chunks: true } },
    },
  });
}

export async function getDocument(ctx: TenantContext, id: string) {
  assertPermission(ctx, "knowledge:read");
  return prisma.knowledgeDocument.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: {
      id: true,
      title: true,
      content: true,
      status: true,
      sourceType: true,
      sourceFilename: true,
      version: true,
      indexedAt: true,
      embeddingModel: true,
      errorMessage: true,
      createdAt: true,
      updatedAt: true,
      createdBy: { select: { name: true } },
      // Never select embeddings into the page; only text and metadata.
      chunks: {
        where: { organizationId: ctx.organizationId },
        orderBy: { index: "asc" },
        select: { id: true, index: true, content: true, tokenEstimate: true, embeddingModel: true },
      },
    },
  });
}

export async function createDocument(
  ctx: TenantContext,
  input: {
    title: string;
    content: string;
    sourceFilename?: string | null;
    sourceType: "MANUAL" | "FILE";
  },
) {
  assertPermission(ctx, "knowledge:write");
  const data = documentInputSchema.parse({ title: input.title, content: input.content });
  // Never store or send card numbers or credentials to the AI provider.
  const blocked = scanKnowledgeContent(data.content).filter((f) => f.severity === "block");
  if (blocked.length) {
    throw new DomainError(
      `This document appears to contain ${blocked.map((f) => FINDING_TEXT[f.kind]).join(" and ")}. Remove them and try again.`,
    );
  }
  const checksum = sha256Hex(data.content);
  const duplicate = await prisma.knowledgeDocument.findFirst({
    where: { organizationId: ctx.organizationId, checksum, status: { not: "ARCHIVED" } },
    select: { title: true },
  });
  if (duplicate)
    throw new DomainError(`The same content already exists in "${duplicate.title}"`, "conflict");

  return prisma.$transaction(async (tx) => {
    const doc = await tx.knowledgeDocument.create({
      data: {
        organizationId: ctx.organizationId,
        title: data.title,
        content: data.content,
        checksum,
        sourceType: input.sourceType,
        sourceFilename: input.sourceFilename?.slice(0, 255) ?? null,
        createdByUserId: ctx.userId,
      },
      select: { id: true },
    });
    await writeAudit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "knowledge.created",
      targetType: "KnowledgeDocument",
      targetId: doc.id,
      metadata: { sourceType: input.sourceType, chars: data.content.length },
    });
    return doc;
  });
}

/**
 * Sends the document's chunks to the embedding provider and stores vectors. Requires
 * knowledge:write AND the AI guard (owner consent, budget, hourly cap).
 */
export async function indexDocument(ctx: TenantContext, runtime: AiRuntime, id: string) {
  assertPermission(ctx, "knowledge:write");
  const doc = await prisma.knowledgeDocument.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: { id: true, content: true },
  });
  if (!doc) throw notFoundInTenant("Document");

  const recorded = withUsageRecording(
    prisma,
    { chat: runtime.chat, embeddings: runtime.embeddings },
    { organizationId: ctx.organizationId, userId: ctx.userId, feature: "KNOWLEDGE_INDEXING" },
    runtime.prices,
  );
  // Concurrency-safe: consent, budget (incl. in-flight calls) and hourly cap are checked and an
  // upper-bound cost is reserved under a per-organization lock.
  const result = await withAiBudget(
    prisma,
    ctx.organizationId,
    runtime,
    {
      amountUsd: estimateIndexingCostUsd(runtime, doc.content ?? ""),
      feature: "KNOWLEDGE_INDEXING",
    },
    () =>
      indexKnowledgeDocument(prisma, recorded.embeddings, {
        organizationId: ctx.organizationId,
        documentId: doc.id,
      }),
  );
  await writeAudit(prisma, {
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "knowledge.indexed",
    targetType: "KnowledgeDocument",
    targetId: doc.id,
    metadata: {
      chunks: result.chunks,
      model: runtime.embeddings.model,
      costUsd: recorded.tally.costUsd,
    },
  });
  return result;
}

/** Archived documents are excluded from retrieval. Nothing is deleted; restoring is possible. */
export async function setDocumentArchived(ctx: TenantContext, id: string, archived: boolean) {
  assertPermission(ctx, "knowledge:write");
  await prisma.$transaction(async (tx) => {
    const doc = await tx.knowledgeDocument.findFirst({
      where: { id, organizationId: ctx.organizationId },
      select: { id: true, indexedAt: true, embeddingModel: true },
    });
    if (!doc) throw notFoundInTenant("Document");
    const restoredStatus = doc.indexedAt && doc.embeddingModel ? "READY" : "DRAFT";
    await tx.knowledgeDocument.update({
      where: { id: doc.id },
      data: { status: archived ? "ARCHIVED" : restoredStatus },
    });
    await writeAudit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: archived ? "knowledge.archived" : "knowledge.restored",
      targetType: "KnowledgeDocument",
      targetId: doc.id,
    });
  });
}
