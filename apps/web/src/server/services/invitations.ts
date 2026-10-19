import { randomBytes } from "node:crypto";
import { canAssignRole, type Role, sha256Hex } from "@ravi/core";
import { type Prisma, prisma } from "@ravi/db";
import { z } from "zod";
import { writeAudit } from "../audit";
import { createCredentialUser, normalizeEmail } from "../auth/users";
import type { EmailSender } from "../email";
import { invitationMessage } from "../email/templates";
import { assertPermission, type TenantContext } from "../tenancy/context";
import { DomainError, notFoundInTenant } from "../tenancy/errors";
import { roleSchema } from "./members";

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const invitationInputSchema = z.object({
  email: z.email("Enter a valid email address").transform(normalizeEmail),
  role: roleSchema,
});

function hashToken(token: string): string {
  return sha256Hex(`ravi-invitation:${token}`);
}

export async function listPendingInvitations(ctx: TenantContext) {
  assertPermission(ctx, "members:manage");
  return prisma.invitation.findMany({
    where: {
      organizationId: ctx.organizationId,
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      role: true,
      expiresAt: true,
      createdAt: true,
      invitedBy: { select: { name: true } },
    },
  });
}

/**
 * Issues a single-use invitation. Only the SHA-256 of the token is stored; the token appears only
 * in the emailed link. Returns the link so local development (outbox adapter) can display it.
 */
export async function createInvitation(
  ctx: TenantContext,
  input: z.input<typeof invitationInputSchema>,
  deps: { email: EmailSender; baseUrl: string; now?: Date },
): Promise<{ id: string; url: string }> {
  assertPermission(ctx, "members:manage");
  const { email, role } = invitationInputSchema.parse(input);
  if (!canAssignRole(ctx.role, role)) {
    throw new DomainError("Only an owner can invite another owner", "forbidden");
  }

  const existingMember = await prisma.membership.findFirst({
    where: { organizationId: ctx.organizationId, user: { email } },
    select: { id: true },
  });
  if (existingMember) throw new DomainError("This person is already a member", "conflict");

  const now = deps.now ?? new Date();
  const token = randomBytes(32).toString("base64url");
  const invitation = await prisma.$transaction(async (tx) => {
    // A new invitation replaces any pending one for the same address.
    await tx.invitation.updateMany({
      where: { organizationId: ctx.organizationId, email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
    const created = await tx.invitation.create({
      data: {
        organizationId: ctx.organizationId,
        email,
        role,
        tokenHash: hashToken(token),
        expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
        invitedByUserId: ctx.userId,
      },
      select: { id: true },
    });
    await writeAudit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "invitation.created",
      targetType: "Invitation",
      targetId: created.id,
      metadata: { email, role },
    });
    return created;
  });

  const url = `${deps.baseUrl.replace(/\/$/, "")}/invite/${token}`;
  const inviter = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { name: true },
  });
  await deps.email.send(
    invitationMessage({
      to: email,
      url,
      organizationName: ctx.organizationName,
      inviterName: inviter?.name ?? "A teammate",
      role: role.charAt(0) + role.slice(1).toLowerCase(),
    }),
  );
  return { id: invitation.id, url };
}

export async function revokeInvitation(ctx: TenantContext, invitationId: string) {
  assertPermission(ctx, "members:manage");
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.invitation.updateMany({
      where: {
        id: invitationId,
        organizationId: ctx.organizationId,
        acceptedAt: null,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
    if (count !== 1) throw notFoundInTenant("Invitation");
    await writeAudit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "invitation.revoked",
      targetType: "Invitation",
      targetId: invitationId,
    });
  });
}

export type InvitationLookup =
  | {
      status: "valid";
      invitation: { id: string; email: string; role: Role; organizationName: string };
      accountExists: boolean;
    }
  | { status: "invalid" | "expired" | "used" };

/** Public lookup by token (from the emailed link). Reveals nothing for unknown tokens. */
export async function lookupInvitation(token: string, now = new Date()): Promise<InvitationLookup> {
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) return { status: "invalid" };
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      email: true,
      role: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      organization: { select: { name: true } },
    },
  });
  if (!invitation || invitation.revokedAt) return { status: "invalid" };
  if (invitation.acceptedAt) return { status: "used" };
  if (invitation.expiresAt <= now) return { status: "expired" };
  const accountExists = Boolean(
    await prisma.user.findUnique({ where: { email: invitation.email }, select: { id: true } }),
  );
  return {
    status: "valid",
    invitation: {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role as Role,
      organizationName: invitation.organization.name,
    },
    accountExists,
  };
}

const INVALID = () =>
  new DomainError("This invitation is invalid or has expired", "invitation_invalid");

/**
 * Accepts an invitation atomically. Marking it accepted is a conditional update, so a token can be
 * used exactly once even under concurrent requests.
 */
async function consumeInvitation(
  token: string,
  resolveUser: (
    tx: Prisma.TransactionClient,
    email: string,
  ) => Promise<{ id: string; email: string }>,
  now: Date,
) {
  return prisma.$transaction(async (tx) => {
    const invitation = await tx.invitation.findUnique({
      where: { tokenHash: hashToken(token) },
      select: { id: true, email: true, role: true, organizationId: true },
    });
    if (!invitation) throw INVALID();

    const user = await resolveUser(tx, invitation.email);
    if (normalizeEmail(user.email) !== invitation.email) {
      throw new DomainError("This invitation was sent to a different email address", "forbidden");
    }

    const { count } = await tx.invitation.updateMany({
      where: { id: invitation.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
      data: { acceptedAt: now, acceptedByUserId: user.id },
    });
    if (count !== 1) throw INVALID();

    const existing = await tx.membership.findFirst({
      where: { organizationId: invitation.organizationId, userId: user.id },
      select: { id: true },
    });
    if (existing)
      throw new DomainError("You are already a member of this organization", "conflict");

    await tx.membership.create({
      data: { organizationId: invitation.organizationId, userId: user.id, role: invitation.role },
    });
    await writeAudit(tx, {
      organizationId: invitation.organizationId,
      actorUserId: user.id,
      action: "invitation.accepted",
      targetType: "Invitation",
      targetId: invitation.id,
      metadata: { role: invitation.role },
    });
    const org = await tx.organization.findUniqueOrThrow({
      where: { id: invitation.organizationId },
      select: { slug: true },
    });
    return { organizationSlug: org.slug, role: invitation.role as Role, userId: user.id };
  });
}

/** For a signed-in user whose email matches the invitation. */
export function acceptInvitationAsUser(
  token: string,
  user: { id: string; email: string },
  now = new Date(),
) {
  return consumeInvitation(token, async () => user, now);
}

/**
 * For a new person: creates their account (email counts as verified, because they proved access
 * by opening the emailed link) and their membership in one transaction. Fails if an account with
 * that email already exists; that person must sign in and accept instead.
 */
export function acceptInvitationAsNewUser(
  token: string,
  input: { name: string; password: string },
  now = new Date(),
) {
  return consumeInvitation(
    token,
    async (tx, email) => {
      if (await tx.user.findUnique({ where: { email }, select: { id: true } })) {
        throw new DomainError(
          "An account already exists for this email. Sign in to accept.",
          "conflict",
        );
      }
      return createCredentialUser(tx, {
        email,
        name: input.name,
        password: input.password,
        emailVerified: true,
      });
    },
    now,
  );
}
