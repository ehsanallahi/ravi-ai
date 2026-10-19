import { type LeadStatus, Prisma, prisma } from "@ravi/db";
import { z } from "zod";
import { writeAudit } from "../audit";
import { assertPermission, type TenantContext } from "../tenancy/context";
import { DomainError, notFoundInTenant } from "../tenancy/errors";

export const LEAD_STATUSES = ["NEW", "CONTACTED", "QUALIFIED", "WON", "LOST"] as const;

export const leadInputSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  status: z.enum(LEAD_STATUSES).default("NEW"),
  notes: z.string().trim().max(5000).optional().default(""),
  estimatedValue: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined))
    .pipe(
      z
        .string()
        .regex(/^\d{1,10}(\.\d{1,2})?$/, "Use a number with up to 2 decimals")
        .optional(),
    ),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .optional()
    .transform((v) => (v ? v : undefined))
    .pipe(
      z
        .string()
        .regex(/^[A-Z]{3}$/, "Use a 3-letter currency code")
        .optional(),
    ),
});
export type LeadInput = z.input<typeof leadInputSchema>;

export async function listLeads(ctx: TenantContext, query: { status?: LeadStatus } = {}) {
  assertPermission(ctx, "leads:read");
  return prisma.lead.findMany({
    where: {
      organizationId: ctx.organizationId,
      ...(query.status ? { status: query.status } : {}),
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: 100,
    select: {
      id: true,
      title: true,
      status: true,
      estimatedValue: true,
      currency: true,
      updatedAt: true,
      contact: { select: { id: true, waId: true, profileName: true, displayName: true } },
      owner: { select: { id: true, name: true } },
    },
  });
}

export async function getLead(ctx: TenantContext, id: string) {
  assertPermission(ctx, "leads:read");
  return prisma.lead.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: {
      id: true,
      title: true,
      status: true,
      notes: true,
      estimatedValue: true,
      currency: true,
      createdAt: true,
      updatedAt: true,
      contact: { select: { id: true, waId: true, profileName: true, displayName: true } },
    },
  });
}

export async function createLead(ctx: TenantContext, contactId: string, input: LeadInput) {
  assertPermission(ctx, "leads:write");
  const data = leadInputSchema.parse(input);
  // The contact must belong to this organization; a foreign contact ID looks like a missing one.
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, organizationId: ctx.organizationId },
    select: { id: true },
  });
  if (!contact) throw notFoundInTenant("Contact");

  return prisma.$transaction(async (tx) => {
    const lead = await tx.lead.create({
      data: {
        organizationId: ctx.organizationId,
        contactId: contact.id,
        title: data.title,
        status: data.status,
        notes: data.notes || null,
        estimatedValue: data.estimatedValue ? new Prisma.Decimal(data.estimatedValue) : null,
        currency: data.currency ?? null,
        ownerUserId: ctx.userId,
        source: "dashboard",
      },
      select: { id: true },
    });
    await writeAudit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "lead.created",
      targetType: "Lead",
      targetId: lead.id,
    });
    return lead;
  });
}

export async function updateLead(ctx: TenantContext, id: string, input: LeadInput) {
  assertPermission(ctx, "leads:write");
  const data = leadInputSchema.parse(input);
  if (data.estimatedValue && !data.currency) {
    throw new DomainError("Add a currency for the estimated value");
  }
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.lead.updateMany({
      where: { id, organizationId: ctx.organizationId },
      data: {
        title: data.title,
        status: data.status,
        notes: data.notes || null,
        estimatedValue: data.estimatedValue ? new Prisma.Decimal(data.estimatedValue) : null,
        currency: data.currency ?? null,
      },
    });
    if (count !== 1) throw notFoundInTenant("Lead");
    await writeAudit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "lead.updated",
      targetType: "Lead",
      targetId: id,
      metadata: { status: data.status },
    });
  });
}
