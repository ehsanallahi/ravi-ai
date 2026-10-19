import { Prisma, prisma } from "@ravi/db";
import { type AiRuntime, askAssistant, getAiUsageSummary } from "@ravi/knowledge";
import { z } from "zod";
import { writeAudit } from "../audit";
import { assertPermission, type TenantContext } from "../tenancy/context";
import { DomainError, notFoundInTenant } from "../tenancy/errors";

/** AI status for the settings and playground pages. Never includes the API key. */
export async function getAiStatus(ctx: TenantContext, runtime: AiRuntime | null) {
  assertPermission(ctx, "knowledge:read");
  const limits = runtime?.limits ?? { monthlyBudgetUsd: 0, requestsPerHour: 0 };
  const [usage, org] = await Promise.all([
    getAiUsageSummary(prisma, ctx.organizationId, limits),
    prisma.organization.findUniqueOrThrow({
      where: { id: ctx.organizationId },
      select: { aiMonthlyBudgetUsd: true, aiAutoReplyEnabled: true },
    }),
  ]);
  return {
    configured: Boolean(runtime?.configured),
    models: runtime?.models ?? null,
    usage,
    platformBudgetUsd: limits.monthlyBudgetUsd,
    orgBudgetUsd:
      org.aiMonthlyBudgetUsd === null ? null : Number(org.aiMonthlyBudgetUsd.toString()),
    autoReplyEnabled: org.aiAutoReplyEnabled,
  };
}

/**
 * Explicit opt-in before any organization data is sent to the AI provider. Owner only.
 * Revoking stops all future AI calls immediately.
 */
export async function setAiConsent(ctx: TenantContext, granted: boolean) {
  assertPermission(ctx, "org:manage");
  await prisma.$transaction(async (tx) => {
    await tx.organization.update({
      where: { id: ctx.organizationId },
      data: granted
        ? { aiDataConsentAt: new Date(), aiDataConsentByUserId: ctx.userId }
        : { aiDataConsentAt: null, aiDataConsentByUserId: null },
    });
    await writeAudit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: granted ? "ai.consent_granted" : "ai.consent_revoked",
      targetType: "Organization",
      targetId: ctx.organizationId,
    });
  });
}

/** Owners may set a lower monthly cap than the platform default; never a higher one. */
export async function setAiBudget(
  ctx: TenantContext,
  budgetUsd: number | null,
  platformBudgetUsd: number,
) {
  assertPermission(ctx, "org:manage");
  if (budgetUsd !== null) {
    if (!Number.isFinite(budgetUsd) || budgetUsd < 0)
      throw new DomainError("Enter a budget of 0 or more");
    if (budgetUsd > platformBudgetUsd) {
      throw new DomainError(`The platform limit is $${platformBudgetUsd.toFixed(2)} per month`);
    }
  }
  await prisma.$transaction(async (tx) => {
    await tx.organization.update({
      where: { id: ctx.organizationId },
      data: {
        aiMonthlyBudgetUsd: budgetUsd === null ? null : new Prisma.Decimal(budgetUsd.toFixed(2)),
      },
    });
    await writeAudit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "ai.budget_changed",
      targetType: "Organization",
      targetId: ctx.organizationId,
      metadata: { budgetUsd },
    });
  });
}

/** Playground question. Owner/Admin only. Results are stored for review; nothing is sent. */
export async function askPlayground(ctx: TenantContext, runtime: AiRuntime, question: string) {
  assertPermission(ctx, "ai:configure");
  return askAssistant(prisma, runtime, {
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    businessName: ctx.organizationName,
    question,
  });
}

export async function listSuggestions(ctx: TenantContext, take = 20) {
  assertPermission(ctx, "ai:configure");
  return prisma.aiSuggestion.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      question: true,
      decision: true,
      handoffReason: true,
      status: true,
      rating: true,
      language: true,
      createdAt: true,
    },
  });
}

export interface StoredSource {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  excerpt: string;
  score: number;
  similarity?: number;
  cited: boolean;
}

export async function getSuggestion(ctx: TenantContext, id: string) {
  assertPermission(ctx, "ai:configure");
  const s = await prisma.aiSuggestion.findFirst({
    where: { id, organizationId: ctx.organizationId },
  });
  if (!s) return null;
  return {
    ...s,
    sources: (Array.isArray(s.sources) ? s.sources : []) as unknown as StoredSource[],
  };
}

export const reviewSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  notes: z.string().trim().max(2000).optional(),
});

/**
 * Records a reviewer's verdict on a suggestion. Approval is an evaluation signal only: it does
 * NOT send anything to WhatsApp (sending is a separately approved Phase 3 gate).
 */
export async function reviewSuggestion(
  ctx: TenantContext,
  id: string,
  input: z.input<typeof reviewSchema>,
) {
  assertPermission(ctx, "ai:configure");
  const data = reviewSchema.parse(input);
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.aiSuggestion.updateMany({
      where: { id, organizationId: ctx.organizationId },
      data: {
        status: data.status,
        rating: data.rating ?? null,
        reviewNotes: data.notes || null,
        reviewedByUserId: ctx.userId,
        reviewedAt: new Date(),
      },
    });
    if (count !== 1) throw notFoundInTenant("Suggestion");
    await writeAudit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "ai.suggestion_reviewed",
      targetType: "AiSuggestion",
      targetId: id,
      metadata: { status: data.status, rating: data.rating ?? null },
    });
  });
}
