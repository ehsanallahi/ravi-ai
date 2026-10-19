import { prisma } from "@ravi/db";
import { writeAudit } from "../audit";
import { assertPermission, type TenantContext } from "../tenancy/context";
import { notFoundInTenant } from "../tenancy/errors";

const PAGE_SIZE = 25;

export async function listContacts(
  ctx: TenantContext,
  query: { q?: string; cursor?: string } = {},
) {
  assertPermission(ctx, "contacts:read");
  const q = query.q?.trim().slice(0, 100);
  const rows = await prisma.contact.findMany({
    where: {
      organizationId: ctx.organizationId,
      ...(q
        ? {
            OR: [
              { waId: { contains: q.replace(/[^\d]/g, "") || q } },
              { profileName: { contains: q, mode: "insensitive" } },
              { displayName: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: [{ lastInboundAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      waId: true,
      profileName: true,
      displayName: true,
      optedOutAt: true,
      lastInboundAt: true,
      _count: { select: { conversations: true, leads: true } },
    },
  });
  const hasMore = rows.length > PAGE_SIZE;
  const items = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
}

export async function getContact(ctx: TenantContext, id: string) {
  assertPermission(ctx, "contacts:read");
  return prisma.contact.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: {
      id: true,
      waId: true,
      profileName: true,
      displayName: true,
      optedOutAt: true,
      lastInboundAt: true,
      createdAt: true,
      conversations: {
        where: { organizationId: ctx.organizationId },
        orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
        take: 20,
        select: { id: true, status: true, lastMessageAt: true },
      },
      leads: {
        where: { organizationId: ctx.organizationId },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, title: true, status: true, createdAt: true },
      },
    },
  });
}

/** Opt-out blocks all automated messages to the contact. */
export async function setContactOptOut(ctx: TenantContext, id: string, optedOut: boolean) {
  assertPermission(ctx, "contacts:write");
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.contact.updateMany({
      where: { id, organizationId: ctx.organizationId },
      data: { optedOutAt: optedOut ? new Date() : null },
    });
    if (count !== 1) throw notFoundInTenant("Contact");
    await writeAudit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: optedOut ? "contact.opted_out" : "contact.opted_in",
      targetType: "Contact",
      targetId: id,
    });
  });
}
