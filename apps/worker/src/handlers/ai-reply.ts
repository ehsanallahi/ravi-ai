import { type ChatMessage, generateGroundedReply, isRetryableProviderError } from "@ravi/ai-engine";
import { errorMessage } from "@ravi/core";
import { Prisma } from "@ravi/db";
import {
  AiGuardError,
  estimateAssistantCostUsd,
  PgHybridRetriever,
  withAiBudget,
  withUsageRecording,
} from "@ravi/knowledge";
import {
  aiReplyModeFromPayload,
  isWithinServiceWindow,
  JOB_TYPES,
  type JobHandler,
  messageIdFromPayload,
  NonRetryableError,
} from "../jobs";
import { enqueueJob } from "../queue";

const HISTORY_LIMIT = 20;

export const handleAiReply: JobHandler = async (job, ctx) => {
  const messageId = messageIdFromPayload(job.payload);
  const mode = aiReplyModeFromPayload(job.payload);
  const inbound = await ctx.prisma.message.findUnique({
    where: { id: messageId },
    include: { conversation: { include: { contact: true, organization: true } } },
  });
  if (!inbound || inbound.direction !== "INBOUND") return;

  const { conversation } = inbound;
  const { contact, organization } = conversation;
  const log = ctx.log.child({
    organizationId: organization.id,
    conversationId: conversation.id,
    mode,
  });

  // Guards: re-checked here because settings may change between enqueue and execution.
  const enabled =
    mode === "draft"
      ? ctx.env.AI_DRAFT_REPLIES_ENABLED && conversation.aiEnabled
      : ctx.env.AI_AUTO_REPLY_ENABLED && organization.aiAutoReplyEnabled && conversation.aiEnabled;
  if (!enabled) {
    log.info("ai reply skipped: disabled");
    return;
  }
  if (contact.optedOutAt) {
    log.info("ai reply skipped: contact opted out");
    return;
  }
  // Drafts are never sent, so the 24-hour window only matters for automatic replies.
  if (mode === "auto" && !isWithinServiceWindow(contact.lastInboundAt, ctx.now())) {
    log.info("ai reply skipped: outside 24h customer service window");
    return;
  }

  // Answer only the newest message: a newer inbound gets its own job, and a newer outbound
  // means a human (or an earlier reply) already answered.
  const newer = await ctx.prisma.message.findFirst({
    where: { conversationId: conversation.id, createdAt: { gt: inbound.createdAt } },
    select: { id: true },
  });
  if (newer) {
    log.info("ai reply skipped: newer messages exist");
    return;
  }

  const recent = await ctx.prisma.message.findMany({
    where: { conversationId: conversation.id, body: { not: null } },
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT,
    select: { direction: true, body: true },
  });
  const history: ChatMessage[] = recent.reverse().map((m) => ({
    role: m.direction === "INBOUND" ? "user" : "assistant",
    content: m.body ?? "",
  }));

  const feature = mode === "draft" ? "DRAFT_REPLY" : "AUTO_REPLY";
  const started = Date.now();
  const recorded = withUsageRecording(
    ctx.prisma,
    { chat: ctx.ai.chat, embeddings: ctx.ai.embeddings },
    { organizationId: organization.id, feature },
    ctx.ai.prices,
  );

  let decision;
  try {
    // Same gates as the dashboard, concurrency-safe: consent, budget (incl. in-flight calls),
    // hourly cap; an upper-bound cost is reserved for the duration of the call.
    decision = await withAiBudget(
      ctx.prisma,
      organization.id,
      ctx.ai,
      { amountUsd: estimateAssistantCostUsd(ctx.ai), feature },
      () =>
        generateGroundedReply({
          provider: recorded.chat,
          retriever: new PgHybridRetriever(ctx.prisma, recorded.embeddings, ctx.ai.retrieval),
          organizationId: organization.id,
          businessName: organization.name,
          history,
        }),
    );
  } catch (err) {
    if (err instanceof AiGuardError) {
      log.info("ai reply skipped: guard", { reason: err.reason });
      return;
    }
    if (!isRetryableProviderError(err)) throw new NonRetryableError(errorMessage(err));
    throw err;
  }

  if (mode === "draft") {
    // Stored for review only: no outbound message, no send job, no conversation change.
    await ctx.prisma.aiSuggestion.create({
      data: {
        organizationId: organization.id,
        source: "conversation",
        conversationId: conversation.id,
        question: inbound.body ?? "",
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
    });
    log.info("ai draft stored for review (not sent)", { decision: decision.kind });
    return;
  }

  if (decision.kind === "handoff") {
    await ctx.prisma.conversation.update({
      where: { id: conversation.id },
      data: { status: "PENDING" },
    });
    log.info("conversation handed off to a human", { reason: decision.reason });
    return;
  }

  await ctx.prisma.$transaction(async (tx) => {
    const outbound = await tx.message.create({
      data: {
        organizationId: organization.id,
        conversationId: conversation.id,
        direction: "OUTBOUND",
        senderType: "AI",
        type: "TEXT",
        body: decision.text,
        status: "PENDING",
        metadata: {
          model: decision.model,
          sourceChunkIds: decision.sources.filter((s) => s.cited).map((s) => s.chunkId),
          language: decision.language,
          inReplyTo: inbound.id,
        },
      },
    });
    await enqueueJob(tx, {
      type: JOB_TYPES.whatsappSend,
      payload: { messageId: outbound.id },
      dedupeKey: `send:${outbound.id}`,
      organizationId: organization.id,
    });
  });
  log.info("ai reply drafted and queued for sending");
};
