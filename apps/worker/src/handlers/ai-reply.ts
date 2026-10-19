import { type ChatMessage, generateGroundedReply, isRetryableProviderError } from "@ravi/ai-engine";
import { errorMessage } from "@ravi/core";
import { isUniqueViolation, Prisma } from "@ravi/db";
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
import { compareMessages, orderTimeFilter } from "../message-order";
import { enqueueJob } from "../queue";

/** Earlier messages given to the model as context (never as questions to answer). */
const CONTEXT_LIMIT = 10;
/** Recent messages fetched before exact ordering; generous so late deliveries are included. */
const ORDER_CANDIDATES = 50;

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

  // One draft per inbound message: a retried or duplicated job finds the stored draft and stops.
  if (mode === "draft") {
    const existing = await ctx.prisma.aiSuggestion.findUnique({
      where: { messageId: inbound.id },
      select: { id: true },
    });
    if (existing) {
      log.info("ai draft skipped: already drafted for this message");
      return;
    }
  }

  // A newer outbound message means a human (or an earlier reply) already answered. Automatic
  // replies also skip when a newer inbound exists (it gets its own job); drafts do not, so every
  // customer message gets its own draft even when messages arrive close together.
  // Order is WhatsApp's send time (see message-order.ts), not insertion time: concurrent or late
  // webhook deliveries can insert messages out of order.
  const scope = {
    organizationId: organization.id,
    conversationId: conversation.id,
    id: { not: inbound.id },
  };
  const later = await ctx.prisma.message.findMany({
    where: {
      ...scope,
      ...orderTimeFilter(inbound, "after"),
      ...(mode === "draft" ? { direction: "OUTBOUND" as const } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: ORDER_CANDIDATES,
    select: { id: true, waTimestamp: true, createdAt: true },
  });
  if (later.some((m) => compareMessages(m, inbound) > 0)) {
    log.info("ai reply skipped: newer messages exist");
    return;
  }

  // Context: only messages of this tenant and conversation sent BEFORE the triggering message,
  // so a job that runs late or out of order never sees (or answers) later messages.
  const candidates = await ctx.prisma.message.findMany({
    where: { ...scope, ...orderTimeFilter(inbound, "before"), body: { not: null } },
    orderBy: { createdAt: "desc" },
    take: ORDER_CANDIDATES,
    select: { id: true, waTimestamp: true, createdAt: true, direction: true, body: true },
  });
  const earlier = candidates
    .filter((m) => compareMessages(m, inbound) < 0)
    .sort(compareMessages)
    .slice(-CONTEXT_LIMIT);
  const context: ChatMessage[] = earlier.map((m) => ({
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
          message: inbound.body ?? "",
          context,
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
    try {
      await ctx.prisma.aiSuggestion.create({
        data: {
          organizationId: organization.id,
          source: "conversation",
          conversationId: conversation.id,
          messageId: inbound.id,
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
    } catch (err) {
      // A concurrent run of the same job stored its draft first; keep that one.
      if (isUniqueViolation(err)) {
        log.info("ai draft skipped: already drafted for this message");
        return;
      }
      throw err;
    }
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
