import { prisma } from "@ravi/db";
import { assertPermission, type TenantContext } from "../tenancy/context";

/** Real counts for one organization. Zero means zero; nothing is estimated or invented. */
export async function getOverviewStats(ctx: TenantContext) {
  assertPermission(ctx, "conversations:read");
  const organizationId = ctx.organizationId;
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [open, pending, contacts, leadsByStatus, inbound7d, outbound7d, whatsappAccounts] =
    await Promise.all([
      prisma.conversation.count({ where: { organizationId, status: "OPEN" } }),
      prisma.conversation.count({ where: { organizationId, status: "PENDING" } }),
      prisma.contact.count({ where: { organizationId } }),
      prisma.lead.groupBy({ by: ["status"], where: { organizationId }, _count: { _all: true } }),
      prisma.message.count({
        where: { organizationId, direction: "INBOUND", createdAt: { gte: since } },
      }),
      prisma.message.count({
        where: { organizationId, direction: "OUTBOUND", createdAt: { gte: since } },
      }),
      prisma.whatsAppAccount.count({ where: { organizationId, status: "ACTIVE" } }),
    ]);

  const leads = Object.fromEntries(leadsByStatus.map((g) => [g.status, g._count._all])) as Partial<
    Record<string, number>
  >;
  const activeLeads = (leads.NEW ?? 0) + (leads.CONTACTED ?? 0) + (leads.QUALIFIED ?? 0);

  return {
    conversations: { open, pending },
    contacts,
    leads: { active: activeLeads, won: leads.WON ?? 0, lost: leads.LOST ?? 0 },
    messages7d: { inbound: inbound7d, outbound: outbound7d },
    whatsappAccounts,
  };
}

export async function getRecentConversations(ctx: TenantContext) {
  assertPermission(ctx, "conversations:read");
  return prisma.conversation.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }],
    take: 5,
    select: {
      id: true,
      status: true,
      lastMessageAt: true,
      contact: { select: { waId: true, profileName: true, displayName: true } },
    },
  });
}
