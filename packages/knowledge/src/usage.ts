import {
  estimateChatCostUsd,
  estimateEmbeddingCostUsd,
  type GenerateResult,
  type PriceOverrides,
  providerErrorCode,
} from "@ravi/ai-engine";
import { type AiFeature, Prisma, type PrismaClient } from "@ravi/db";

export type AiGuardReason = "not_configured" | "no_consent" | "budget_exceeded" | "rate_limited";

/** A refusal to call the AI provider. Messages are safe to show to administrators. */
export class AiGuardError extends Error {
  constructor(
    public readonly reason: AiGuardReason,
    message: string,
  ) {
    super(message);
    this.name = "AiGuardError";
  }
}

export function startOfMonthUtc(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export interface AiUsageSummary {
  monthToDateUsd: number;
  budgetUsd: number;
  remainingUsd: number;
  requestsLastHour: number;
  requestsPerHour: number;
  consentAt: Date | null;
}

/** Effective budget = the organization's own cap, never above the platform cap. */
export function effectiveBudget(
  orgBudget: Prisma.Decimal | null,
  platformBudgetUsd: number,
): number {
  if (orgBudget === null) return platformBudgetUsd;
  return Math.min(Number(orgBudget.toString()), platformBudgetUsd);
}

export async function getAiUsageSummary(
  prisma: PrismaClient,
  organizationId: string,
  limits: { monthlyBudgetUsd: number; requestsPerHour: number },
  now = new Date(),
): Promise<AiUsageSummary> {
  const [org, spend, recent] = await Promise.all([
    prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { aiMonthlyBudgetUsd: true, aiDataConsentAt: true },
    }),
    prisma.aiUsageEvent.aggregate({
      where: { organizationId, createdAt: { gte: startOfMonthUtc(now) } },
      _sum: { estimatedCostUsd: true },
    }),
    prisma.aiUsageEvent.count({
      where: { organizationId, createdAt: { gte: new Date(now.getTime() - 60 * 60 * 1000) } },
    }),
  ]);
  const monthToDateUsd = Number(spend._sum.estimatedCostUsd?.toString() ?? 0);
  const budgetUsd = effectiveBudget(org.aiMonthlyBudgetUsd, limits.monthlyBudgetUsd);
  return {
    monthToDateUsd,
    budgetUsd,
    remainingUsd: Math.max(0, budgetUsd - monthToDateUsd),
    requestsLastHour: recent,
    requestsPerHour: limits.requestsPerHour,
    consentAt: org.aiDataConsentAt,
  };
}

/**
 * Must pass before ANY call to a third-party AI provider for an organization:
 * the provider is configured, an Owner has opted in to sending data, the monthly budget has room,
 * and the hourly request cap is not reached.
 */
export async function assertAiAllowed(
  prisma: PrismaClient,
  organizationId: string,
  runtime: { configured: boolean; limits: { monthlyBudgetUsd: number; requestsPerHour: number } },
  now = new Date(),
): Promise<AiUsageSummary> {
  if (!runtime.configured) {
    throw new AiGuardError(
      "not_configured",
      "AI is not configured on this server (GEMINI_API_KEY is missing).",
    );
  }
  const summary = await getAiUsageSummary(prisma, organizationId, runtime.limits, now);
  if (!summary.consentAt) {
    throw new AiGuardError(
      "no_consent",
      "An owner must enable AI data processing in Settings before any data is sent to the AI provider.",
    );
  }
  if (summary.remainingUsd <= 0) {
    throw new AiGuardError(
      "budget_exceeded",
      "This organization's monthly AI budget has been reached.",
    );
  }
  if (summary.requestsLastHour >= summary.requestsPerHour) {
    throw new AiGuardError("rate_limited", "Hourly AI request limit reached. Try again later.");
  }
  return summary;
}

interface UsageBase {
  organizationId: string;
  userId?: string | null;
  feature: AiFeature;
  provider: string;
  model: string;
  latencyMs: number;
}

export async function recordChatUsage(
  prisma: PrismaClient | Prisma.TransactionClient,
  base: UsageBase,
  result: GenerateResult | null,
  prices: PriceOverrides,
  error?: unknown,
): Promise<{ id: string; estimatedCostUsd: number }> {
  const usage = result?.usage ?? { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 };
  let cost = 0;
  try {
    cost = estimateChatCostUsd(base.model, usage, new Date(), prices);
  } catch {
    cost = 0;
  }
  const event = await prisma.aiUsageEvent.create({
    data: {
      ...base,
      userId: base.userId ?? null,
      operation: "CHAT",
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      thinkingTokens: usage.thinkingTokens,
      estimatedCostUsd: new Prisma.Decimal(cost.toFixed(6)),
      success: !error,
      errorCode: error ? providerErrorCode(error) : null,
    },
    select: { id: true },
  });
  return { id: event.id, estimatedCostUsd: cost };
}

export async function recordEmbeddingUsage(
  prisma: PrismaClient | Prisma.TransactionClient,
  base: UsageBase,
  details: { inputTokens: number; dimensions: number },
  prices: PriceOverrides,
  error?: unknown,
): Promise<number> {
  let cost = 0;
  try {
    cost = estimateEmbeddingCostUsd(base.model, details.inputTokens, prices);
  } catch {
    cost = 0;
  }
  await prisma.aiUsageEvent.create({
    data: {
      ...base,
      userId: base.userId ?? null,
      operation: "EMBEDDING",
      inputTokens: details.inputTokens,
      embeddingDimensions: details.dimensions,
      estimatedCostUsd: new Prisma.Decimal(cost.toFixed(6)),
      success: !error,
      errorCode: error ? providerErrorCode(error) : null,
    },
  });
  return cost;
}
