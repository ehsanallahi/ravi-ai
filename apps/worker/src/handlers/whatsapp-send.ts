import { decryptSecret } from "@ravi/core";
import { sendTextMessage, WhatsAppApiError } from "@ravi/whatsapp";
import {
  isWithinServiceWindow,
  type JobHandler,
  messageIdFromPayload,
  NonRetryableError,
  type WorkerContext,
} from "../jobs";

async function markFailed(ctx: WorkerContext, id: string, message: string, code?: number | null) {
  await ctx.prisma.message.update({
    where: { id },
    data: { status: "FAILED", errorMessage: message, errorCode: code ?? null },
  });
}

export const handleWhatsAppSend: JobHandler = async (job, ctx) => {
  const messageId = messageIdFromPayload(job.payload);
  const message = await ctx.prisma.message.findUnique({
    where: { id: messageId },
    include: { conversation: { include: { contact: true, whatsappAccount: true } } },
  });
  // Idempotency: never resend a message that already has a WhatsApp ID or a final status.
  if (!message || message.direction !== "OUTBOUND" || message.waMessageId) return;
  if (message.status !== "PENDING") return;

  const { contact, whatsappAccount } = message.conversation;
  const log = ctx.log.child({ organizationId: message.organizationId, messageId: message.id });

  if (message.senderType === "AI" && contact.optedOutAt) {
    await markFailed(ctx, message.id, "Contact has opted out of automated messages");
    return;
  }
  if (!isWithinServiceWindow(contact.lastInboundAt, ctx.now())) {
    // Free-form messages outside the window need an approved template (not implemented yet).
    await markFailed(ctx, message.id, "Outside the 24-hour customer service window");
    return;
  }
  if (whatsappAccount.status !== "ACTIVE") {
    await markFailed(ctx, message.id, "WhatsApp account is disabled");
    return;
  }
  if (!whatsappAccount.accessTokenCiphertext || !ctx.encryptionKey) {
    throw new NonRetryableError("Missing WhatsApp access token or ENCRYPTION_KEY");
  }
  if (!message.body) {
    await markFailed(ctx, message.id, "Message has no body");
    return;
  }

  const accessToken = decryptSecret(whatsappAccount.accessTokenCiphertext, ctx.encryptionKey);

  try {
    const { messageId: waMessageId } = await sendTextMessage({
      accessToken,
      phoneNumberId: whatsappAccount.phoneNumberId,
      to: contact.waId,
      body: message.body,
      graphApiVersion: ctx.env.WHATSAPP_GRAPH_API_VERSION,
    });
    const now = ctx.now();
    await ctx.prisma.$transaction([
      ctx.prisma.message.update({
        where: { id: message.id },
        data: { waMessageId, status: "SENT", waTimestamp: now },
      }),
      ctx.prisma.conversation.update({
        where: { id: message.conversationId },
        data: { lastMessageAt: now },
      }),
    ]);
    log.info("message sent");
  } catch (err) {
    if (err instanceof WhatsAppApiError) {
      const finalAttempt = job.attempts >= job.maxAttempts;
      if (!err.retryable || finalAttempt) {
        await markFailed(ctx, message.id, err.message, err.code);
        log.warn("message send failed", { code: err.code, httpStatus: err.httpStatus });
        return;
      }
    }
    throw err;
  }
};
