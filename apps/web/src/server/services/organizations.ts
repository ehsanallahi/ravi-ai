import { type Prisma, prisma } from "@ravi/db";
import { z } from "zod";
import { writeAudit } from "../audit";
import { assertPermission, ORG_SLUG_PATTERN, type TenantContext } from "../tenancy/context";
import { DomainError } from "../tenancy/errors";

/** Slugs that collide with routes or could be confused with the platform itself. */
const RESERVED_SLUGS = new Set([
  "admin",
  "api",
  "app",
  "auth",
  "account",
  "dashboard",
  "help",
  "invite",
  "login",
  "logout",
  "new",
  "o",
  "ravi",
  "ravi-ai",
  "settings",
  "signup",
  "support",
  "www",
]);

export const organizationSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Slug must be at least 3 characters")
  .max(48, "Slug must be at most 48 characters")
  .regex(ORG_SLUG_PATTERN, "Use lowercase letters, numbers and single hyphens")
  .refine((s) => !RESERVED_SLUGS.has(s), "This slug is reserved");

export const organizationSettingsSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(120),
  timezone: z
    .string()
    .trim()
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "Unknown time zone"),
});

/** Used by the owner CLI inside a transaction that also creates the owner account. */
export async function createOrganizationWithOwner(
  tx: Prisma.TransactionClient,
  input: { name: string; slug: string; ownerUserId: string },
) {
  const slug = organizationSlugSchema.parse(input.slug);
  const name = organizationSettingsSchema.shape.name.parse(input.name);
  if (await tx.organization.findUnique({ where: { slug }, select: { id: true } })) {
    throw new DomainError("An organization with this slug already exists", "conflict");
  }
  const organization = await tx.organization.create({ data: { name, slug } });
  await tx.membership.create({
    data: { organizationId: organization.id, userId: input.ownerUserId, role: "OWNER" },
  });
  await writeAudit(tx, {
    organizationId: organization.id,
    actorUserId: input.ownerUserId,
    action: "organization.created",
    targetType: "Organization",
    targetId: organization.id,
    metadata: { via: "cli" },
  });
  return organization;
}

export async function getOrganizationSettings(ctx: TenantContext) {
  assertPermission(ctx, "settings:manage");
  return prisma.organization.findUniqueOrThrow({
    where: { id: ctx.organizationId },
    select: {
      id: true,
      name: true,
      slug: true,
      timezone: true,
      aiAutoReplyEnabled: true,
      createdAt: true,
    },
  });
}

/** Name and time zone only. The slug is immutable (it is in every URL), and AI stays off. */
export async function updateOrganizationSettings(
  ctx: TenantContext,
  input: z.input<typeof organizationSettingsSchema>,
) {
  assertPermission(ctx, "settings:manage");
  const data = organizationSettingsSchema.parse(input);
  await prisma.$transaction(async (tx) => {
    await tx.organization.update({ where: { id: ctx.organizationId }, data });
    await writeAudit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "organization.updated",
      targetType: "Organization",
      targetId: ctx.organizationId,
      metadata: data,
    });
  });
}

export async function listAuditLog(ctx: TenantContext, take = 50) {
  assertPermission(ctx, "audit:read");
  return prisma.auditLog.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      action: true,
      targetType: true,
      createdAt: true,
      actor: { select: { name: true, email: true } },
    },
  });
}
