import { canAssignRole, type Role, ROLES } from "@ravi/core";
import { type Prisma, prisma } from "@ravi/db";
import { z } from "zod";
import { writeAudit } from "../audit";
import { assertPermission, type TenantContext } from "../tenancy/context";
import { DomainError, notFoundInTenant } from "../tenancy/errors";

export const roleSchema = z.enum(ROLES);

export async function listMembers(ctx: TenantContext) {
  assertPermission(ctx, "conversations:read");
  return prisma.membership.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      role: true,
      createdAt: true,
      user: { select: { id: true, name: true, email: true, twoFactorEnabled: true } },
    },
  });
}

/** Locks the organization's owner rows so concurrent demotions can't remove the last owner. */
async function lockOwners(tx: Prisma.TransactionClient, organizationId: string): Promise<number> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Membership"
    WHERE "organizationId" = ${organizationId} AND role = 'OWNER'::"MembershipRole"
    FOR UPDATE`;
  return rows.length;
}

async function loadTargetMembership(
  tx: Prisma.TransactionClient,
  ctx: TenantContext,
  membershipId: string,
) {
  const target = await tx.membership.findFirst({
    where: { id: membershipId, organizationId: ctx.organizationId },
    select: { id: true, role: true, userId: true },
  });
  if (!target) throw notFoundInTenant("Member");
  return target;
}

export async function changeMemberRole(ctx: TenantContext, membershipId: string, newRole: Role) {
  assertPermission(ctx, "members:manage");
  const role = roleSchema.parse(newRole);

  await prisma.$transaction(async (tx) => {
    const ownerCount = await lockOwners(tx, ctx.organizationId);
    const target = await loadTargetMembership(tx, ctx, membershipId);
    if (target.role === role) return;

    // Only owners may grant OWNER or change an existing owner's membership.
    if (!canAssignRole(ctx.role, role) || (target.role === "OWNER" && ctx.role !== "OWNER")) {
      throw new DomainError("Only an owner can change owner roles", "forbidden");
    }
    if (target.role === "OWNER" && ownerCount <= 1) {
      throw new DomainError("An organization must keep at least one owner", "last_owner");
    }

    await tx.membership.update({ where: { id: target.id }, data: { role } });
    await writeAudit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "member.role_changed",
      targetType: "Membership",
      targetId: target.id,
      metadata: { userId: target.userId, from: target.role, to: role },
    });
  });
}

export async function removeMember(ctx: TenantContext, membershipId: string) {
  await prisma.$transaction(async (tx) => {
    const ownerCount = await lockOwners(tx, ctx.organizationId);
    const target = await loadTargetMembership(tx, ctx, membershipId);
    const isSelf = target.userId === ctx.userId;

    // Anyone may leave; removing others needs members:manage, and removing an owner needs OWNER.
    if (!isSelf) {
      assertPermission(ctx, "members:manage");
      if (target.role === "OWNER" && ctx.role !== "OWNER") {
        throw new DomainError("Only an owner can remove another owner", "forbidden");
      }
    }
    if (target.role === "OWNER" && ownerCount <= 1) {
      throw new DomainError("An organization must keep at least one owner", "last_owner");
    }

    // Unassign their conversations so nothing points at a non-member.
    await tx.conversation.updateMany({
      where: { organizationId: ctx.organizationId, assignedUserId: target.userId },
      data: { assignedUserId: null },
    });
    await tx.membership.delete({ where: { id: target.id } });
    await writeAudit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: isSelf ? "member.left" : "member.removed",
      targetType: "Membership",
      targetId: target.id,
      metadata: { userId: target.userId, role: target.role },
    });
  });
}
