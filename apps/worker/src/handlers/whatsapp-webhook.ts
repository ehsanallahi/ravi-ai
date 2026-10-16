import type { Prisma, WhatsAppAccount } from "@ravi/db";
import { webhookPayloadSchema } from "@ravi/validation";
import {
  type NormalizedInboundMessage,
  type NormalizedStatus,
  normalizeWebhookPayload,
} from "@ravi/whatsapp";
import { JOB_TYPES, type JobHandler, NonRetryableError, type WorkerContext } from "../jobs";
import { isOptOutRequest, shouldApplyStatus, toMessageStatus, toMessageType } from "../mappers";
import { enqueueJob } from "../queue";

/** Short delay so a burst of customer messages gets one combined AI reply. */
const AI_REPLY_DEBOUNCE_MS = 4_000;

const later = (a: Date | null, b: Date) => (a && a > b ? a : b);

type AccountWithOrg = WhatsAppAccount & { organization: { aiAutoReplyEnabled: boolean } };

export const handleWhatsAppWebhook: JobHandler = async (job, ctx) => {
  const parsed = webhookPayloadSchema.safeParse(job.payload);
  if (!parsed.success) throw new NonRetryableError("Payload is not a WhatsApp webhook envelope");

  const { events, ignoredChanges } = normalizeWebhookPayload(parsed.data);
  if (ignoredChanges) ctx.log.info("ignored webhook changes", { ignoredChanges });

  const accounts = new Map<string, AccountWithOrg | null>();
  for (const event of events) {
    if (!accounts.has(event.phoneNumberId)) {
      accounts.set(
        event.phoneNumberId,
        await ctx.prisma.whatsAppAccount.findUnique({
          where: { phoneNumberId: event.phoneNumberId },
          include: { organization: { select: { aiAutoReplyEnabled: true } } },
        }),
      );
    }
    const account = accounts.get(event.phoneNumberId);
    if (!account || account.status !== "ACTIVE") {
      // Never auto-create tenants from inbound traffic.
      ctx.log.warn("webhook for unregistered or disabled phone number", {
        phoneNumberId: event.phoneNumberId,
      });
      continue;
    }

    if (event.kind === "message") await ingestInboundMessage(ctx, account, event);
    else await applyStatusUpdate(ctx, account, event);
  }
};

async function ingestInboundMessage(
  ctx: WorkerContext,
  account: AccountWithOrg,
  event: NormalizedInboundMessage,
): Promise<void> {
  const organizationId = account.organizationId;
  const optOut = isOptOutRequest(event.text);

  const result = await ctx.prisma.$transaction(async (tx) => {
    const duplicate = await tx.message.findUnique({
      where: { organizationId_waMessageId: { organizationId, waMessageId: event.messageId } },
      select: { id: true },
    });
    if (duplicate) return null;

    const existingContact = await tx.contact.findUnique({
      where: { organizationId_waId: { organizationId, waId: event.waId } },
    });
    const contact = existingContact
      ? await tx.contact.update({
          where: { id: existingContact.id },
          data: {
            profileName: event.profileName ?? existingContact.profileName,
            lastInboundAt: later(existingContact.lastInboundAt, event.timestamp),
            ...(optOut && !existingContact.optedOutAt ? { optedOutAt: ctx.now() } : {}),
          },
        })
      : await tx.contact.create({
          data: {
            organizationId,
            waId: event.waId,
            profileName: event.profileName,
            lastInboundAt: event.timestamp,
            optedOutAt: optOut ? ctx.now() : null,
          },
        });

    const openConversation = await tx.conversation.findFirst({
      where: {
        organizationId,
        contactId: contact.id,
        whatsappAccountId: account.id,
        status: { in: ["OPEN", "PENDING"] },
      },
      orderBy: { createdAt: "desc" },
    });
    const conversation = openConversation
      ? await tx.conversation.update({
          where: { id: openConversation.id },
          data: {
            lastInboundAt: later(openConversation.lastInboundAt, event.timestamp),
            lastMessageAt: later(openConversation.lastMessageAt, event.timestamp),
          },
        })
      : await tx.conversation.create({
          data: {
            organizationId,
            contactId: contact.id,
            whatsappAccountId: account.id,
            lastInboundAt: event.timestamp,
            lastMessageAt: event.timestamp,
          },
        });

    const message = await tx.message.create({
      data: {
        organizationId,
        conversationId: conversation.id,
        direction: "INBOUND",
        senderType: "CONTACT",
        type: toMessageType(event.type),
        body: event.text,
        waMessageId: event.messageId,
        status: "RECEIVED",
        waTimestamp: event.timestamp,
        metadata: { raw: event.raw, replyTo: event.replyToMessageId } as Prisma.InputJsonValue,
      },
    });

    return { contact, conversation, message };
  });

  if (!result) {
    ctx.log.debug("duplicate inbound message ignored", { organizationId });
    return;
  }

  const { contact, conversation, message } = result;
  ctx.log.info("inbound message stored", {
    organizationId,
    conversationId: conversation.id,
    messageId: message.id,
    type: message.type,
    optOut,
  });

  const aiEligible =
    ctx.env.AI_AUTO_REPLY_ENABLED &&
    account.organization.aiAutoReplyEnabled &&
    conversation.aiEnabled &&
    !contact.optedOutAt &&
    message.type === "TEXT" &&
    !!message.body;

  if (aiEligible) {
    await enqueueJob(ctx.prisma, {
      type: JOB_TYPES.aiReply,
      payload: { messageId: message.id },
      dedupeKey: `ai-reply:${message.id}`,
      organizationId,
      runAt: new Date(ctx.now().getTime() + AI_REPLY_DEBOUNCE_MS),
      maxAttempts: 4,
    });
  }
}

async function applyStatusUpdate(
  ctx: WorkerContext,
  account: AccountWithOrg,
  event: NormalizedStatus,
): Promise<void> {
  const next = toMessageStatus(event.status);
  if (!next) return;

  const message = await ctx.prisma.message.findUnique({
    where: {
      organizationId_waMessageId: {
        organizationId: account.organizationId,
        waMessageId: event.messageId,
      },
    },
    select: { id: true, status: true },
  });
  if (!message) {
    // Messages sent outside Ravi AI (for example, from the WhatsApp Business app) are not tracked.
    ctx.log.debug("status for unknown message", { organizationId: account.organizationId });
    return;
  }
  if (!shouldApplyStatus(message.status, next)) return;

  await ctx.prisma.message.update({
    where: { id: message.id },
    data: {
      status: next,
      ...(next === "FAILED"
        ? {
            errorCode: event.error?.code ?? null,
            errorMessage: event.error?.message ?? event.error?.title ?? null,
          }
        : {}),
    },
  });
}
