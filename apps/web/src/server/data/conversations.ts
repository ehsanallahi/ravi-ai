import { type ConversationStatus, type Prisma, prisma } from "@ravi/db";
import { writeAudit } from "../audit";
import { assertPermission, type TenantContext } from "../tenancy/context";
import { notFoundInTenant } from "../tenancy/errors";

const PAGE_SIZE = 25;

export interface ConversationListQuery {
  status?: ConversationStatus;
  assignedToMe?: boolean;
  cursor?: string;
}

export async function listConversations(ctx: TenantContext, query: ConversationListQuery = {}) {
  assertPermission(ctx, "conversations:read");
  const rows = await prisma.conversation.findMany({
    where: {
      organizationId: ctx.organizationId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.assignedToMe ? { assignedUserId: ctx.userId } : {}),
    },
    orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      status: true,
      aiEnabled: true,
      lastMessageAt: true,
      contact: { select: { id: true, waId: true, profileName: true, displayName: true } },
      assignedUser: { select: { id: true, name: true } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { body: true, direction: true, type: true },
      },
    },
  });
  const hasMore = rows.length > PAGE_SIZE;
  const items = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
}

export async function getConversation(ctx: TenantContext, id: string) {
  assertPermission(ctx, "conversations:read");
  const conversation = await prisma.conversation.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: {
      id: true,
      status: true,
      aiEnabled: true,
      createdAt: true,
      lastInboundAt: true,
      contact: {
        select: { id: true, waId: true, profileName: true, displayName: true, optedOutAt: true },
      },
      assignedUser: { select: { id: true, name: true } },
      whatsappAccount: { select: { displayPhoneNumber: true, verifiedName: true } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          direction: true,
          senderType: true,
          type: true,
          body: true,
          status: true,
          errorMessage: true,
          createdAt: true,
        },
      },
    },
  });
  if (!conversation) return null;
  return { ...conversation, messages: conversation.messages.reverse() };
}

async function updateConversation(
  db: Prisma.TransactionClient,
  ctx: TenantContext,
  id: string,
  data: { status?: ConversationStatus; assignedUserId?: string | null; aiEnabled?: false },
) {
  // updateMany with organizationId: a foreign ID updates zero rows instead of another tenant's row.
  const { count } = await db.conversation.updateMany({
    where: { id, organizationId: ctx.organizationId },
    data,
  });
  if (count !== 1) throw notFoundInTenant("Conversation");
}

export async function setConversationStatus(
  ctx: TenantContext,
  id: string,
  status: ConversationStatus,
) {
  assertPermission(ctx, "conversations:reply");
  await prisma.$transaction(async (tx) => {
    await updateConversation(tx, ctx, id, { status });
    await writeAudit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "conversation.status_changed",
      targetType: "Conversation",
      targetId: id,
      metadata: { status },
    });
  });
}

export async function assignConversation(ctx: TenantContext, id: string, userId: string | null) {
  assertPermission(ctx, "conversations:reply");
  if (userId) {
    // The assignee must be a member of the same organization.
    const member = await prisma.membership.findFirst({
      where: { organizationId: ctx.organizationId, userId },
      select: { id: true },
    });
    if (!member) throw notFoundInTenant("Team member");
  }
  await prisma.$transaction(async (tx) => {
    await updateConversation(tx, ctx, id, { assignedUserId: userId });
    await writeAudit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "conversation.assigned",
      targetType: "Conversation",
      targetId: id,
      metadata: { assignedUserId: userId },
    });
  });
}

/** AI can only be turned OFF from the dashboard in Phase 2 (AI replies stay disabled). */
export async function disableConversationAi(ctx: TenantContext, id: string) {
  assertPermission(ctx, "conversations:reply");
  await prisma.$transaction(async (tx) => {
    await updateConversation(tx, ctx, id, { aiEnabled: false });
    await writeAudit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "conversation.ai_disabled",
      targetType: "Conversation",
      targetId: id,
    });
  });
}
