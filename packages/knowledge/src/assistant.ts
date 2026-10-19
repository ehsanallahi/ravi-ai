import { generateGroundedReply, type ReplyDecision } from "@ravi/ai-engine";
import { Prisma, type PrismaClient } from "@ravi/db";
import { withUsageRecording } from "./recording";
import { PgHybridRetriever } from "./retriever";
import type { AiRuntime } from "./runtime";
import { assertAiAllowed } from "./usage";

export const MAX_QUESTION_CHARS = 2000;

export class AssistantInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssistantInputError";
  }
}

/**
 * Runs the full RAG pipeline for a test question and stores the result as an AiSuggestion for
 * review. Nothing is sent anywhere: there is no WhatsApp path in this function.
 * The caller must resolve the tenant and check permissions first.
 */
export async function askAssistant(
  prisma: PrismaClient,
  runtime: AiRuntime,
  input: { organizationId: string; userId: string; businessName: string; question: string },
): Promise<{ suggestionId: string; decision: ReplyDecision }> {
  const question = input.question.trim();
  if (!question) throw new AssistantInputError("Enter a question");
  if (question.length > MAX_QUESTION_CHARS) {
    throw new AssistantInputError(`Questions are limited to ${MAX_QUESTION_CHARS} characters`);
  }

  await assertAiAllowed(prisma, input.organizationId, runtime);

  const started = Date.now();
  const recorded = withUsageRecording(
    prisma,
    { chat: runtime.chat, embeddings: runtime.embeddings },
    { organizationId: input.organizationId, userId: input.userId, feature: "PLAYGROUND" },
    runtime.prices,
  );
  const decision = await generateGroundedReply({
    provider: recorded.chat,
    retriever: new PgHybridRetriever(prisma, recorded.embeddings, runtime.retrieval),
    organizationId: input.organizationId,
    businessName: input.businessName,
    history: [{ role: "user", content: question }],
  });

  const suggestion = await prisma.aiSuggestion.create({
    data: {
      organizationId: input.organizationId,
      createdByUserId: input.userId,
      source: "playground",
      question,
      decision: decision.kind === "reply" ? "REPLY" : "HANDOFF",
      answer: decision.kind === "reply" ? decision.text : null,
      handoffReason: decision.kind === "handoff" ? decision.reason : null,
      withheldDraft: decision.kind === "handoff" ? (decision.withheldDraft ?? null) : null,
      language: decision.language,
      model: decision.generation?.model ?? null,
      sources: decision.sources as unknown as Prisma.InputJsonValue,
      estimatedCostUsd: new Prisma.Decimal(recorded.tally.costUsd.toFixed(6)),
      latencyMs: Date.now() - started,
    },
    select: { id: true },
  });

  return { suggestionId: suggestion.id, decision };
}
