import { can, type Permission, type Role } from "@ravi/core";
import type { PrismaClient } from "@ravi/db";

declare const tenantBrand: unique symbol;

/**
 * Proof that a user is an authorised member of one organization. It can only be created by
 * `resolveTenant`, and every tenant-scoped query takes it, so `organizationId` always comes from
 * a verified membership and never from client input.
 */
export interface TenantContext {
  readonly userId: string;
  readonly organizationId: string;
  readonly organizationSlug: string;
  readonly organizationName: string;
  readonly role: Role;
  readonly [tenantBrand]: true;
}

export type TenantAccessReason =
  "unauthenticated" | "email_unverified" | "not_found" | "two_factor_required" | "forbidden";

export class TenantAccessError extends Error {
  constructor(
    public readonly reason: TenantAccessReason,
    public readonly permission?: Permission,
  ) {
    super(
      reason === "forbidden"
        ? `You don't have permission to do this${permission ? ` (${permission})` : ""}`
        : `Tenant access denied: ${reason}`,
    );
    this.name = "TenantAccessError";
  }
}

/** Owners and admins must have TOTP enabled before they can access an organization. */
export const ROLES_REQUIRING_2FA: ReadonlySet<Role> = new Set<Role>(["OWNER", "ADMIN"]);

export const ORG_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface SessionUser {
  id: string;
  emailVerified?: boolean | null;
  twoFactorEnabled?: boolean | null;
}

export async function resolveTenant(
  prisma: PrismaClient,
  user: SessionUser | null | undefined,
  orgSlug: string,
  permission?: Permission,
): Promise<TenantContext> {
  if (!user) throw new TenantAccessError("unauthenticated");
  if (user.emailVerified === false) throw new TenantAccessError("email_unverified");
  if (!ORG_SLUG_PATTERN.test(orgSlug) || orgSlug.length > 64) {
    throw new TenantAccessError("not_found");
  }

  const membership = await prisma.membership.findFirst({
    where: { userId: user.id, organization: { slug: orgSlug } },
    select: {
      role: true,
      organization: { select: { id: true, slug: true, name: true } },
    },
  });
  // Non-members get "not found", not "forbidden", so organization slugs can't be enumerated.
  if (!membership) throw new TenantAccessError("not_found");

  const role = membership.role as Role;
  if (ROLES_REQUIRING_2FA.has(role) && !user.twoFactorEnabled) {
    throw new TenantAccessError("two_factor_required");
  }
  if (permission && !can(role, permission)) throw new TenantAccessError("forbidden", permission);

  return {
    userId: user.id,
    organizationId: membership.organization.id,
    organizationSlug: membership.organization.slug,
    organizationName: membership.organization.name,
    role,
  } as TenantContext;
}

/** Re-checks a permission on an existing context (for multi-step operations). */
export function assertPermission(ctx: TenantContext, permission: Permission): void {
  if (!can(ctx.role, permission)) throw new TenantAccessError("forbidden", permission);
}

/** All organizations a user belongs to (for the organization switcher). */
export async function listUserOrganizations(prisma: PrismaClient, userId: string) {
  const rows = await prisma.membership.findMany({
    where: { userId },
    select: { role: true, organization: { select: { id: true, slug: true, name: true } } },
    orderBy: { organization: { name: "asc" } },
  });
  return rows.map((r) => ({ ...r.organization, role: r.role as Role }));
}
