/**
 * Role-based access control. Enforce on the server; never trust a role sent by the client.
 */
export const ROLES = ["OWNER", "ADMIN", "AGENT", "VIEWER"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "org:manage",
  "members:manage",
  "whatsapp:connect",
  "settings:manage",
  "ai:configure",
  "knowledge:read",
  "knowledge:write",
  "conversations:read",
  "conversations:reply",
  "contacts:read",
  "contacts:write",
  "leads:read",
  "leads:write",
  "audit:read",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const READ_ONLY: readonly Permission[] = [
  "knowledge:read",
  "conversations:read",
  "contacts:read",
  "leads:read",
];

const AGENT: readonly Permission[] = [
  ...READ_ONLY,
  "conversations:reply",
  "contacts:write",
  "leads:write",
];

const ADMIN: readonly Permission[] = [
  ...AGENT,
  "members:manage",
  "settings:manage",
  "ai:configure",
  "knowledge:write",
  "audit:read",
];

const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  OWNER: new Set(PERMISSIONS),
  ADMIN: new Set(ADMIN),
  AGENT: new Set(AGENT),
  VIEWER: new Set(READ_ONLY),
};

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

export class ForbiddenError extends Error {
  constructor(public readonly permission: Permission) {
    super(`Missing permission: ${permission}`);
    this.name = "ForbiddenError";
  }
}

export function assertCan(role: Role | null | undefined, permission: Permission): void {
  if (!can(role, permission)) throw new ForbiddenError(permission);
}

/** Admins may manage members, but only owners may grant or revoke the OWNER role. */
export function canAssignRole(actor: Role, target: Role): boolean {
  if (target === "OWNER") return actor === "OWNER";
  return can(actor, "members:manage");
}
