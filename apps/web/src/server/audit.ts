import type { Prisma } from "@ravi/db";

export type AuditAction =
  | "organization.created"
  | "organization.updated"
  | "member.role_changed"
  | "member.removed"
  | "member.left"
  | "member.joined"
  | "invitation.created"
  | "invitation.revoked"
  | "invitation.accepted"
  | "conversation.status_changed"
  | "conversation.assigned"
  | "conversation.ai_disabled"
  | "contact.opted_out"
  | "contact.opted_in"
  | "lead.created"
  | "lead.updated"
  | "knowledge.created"
  | "knowledge.indexed"
  | "knowledge.archived"
  | "knowledge.restored"
  | "ai.consent_granted"
  | "ai.consent_revoked"
  | "ai.budget_changed"
  | "ai.suggestion_reviewed";

export async function writeAudit(
  db: Prisma.TransactionClient,
  entry: {
    organizationId: string;
    actorUserId: string | null;
    action: AuditAction;
    targetType?: string;
    targetId?: string;
    metadata?: Prisma.InputJsonValue;
  },
): Promise<void> {
  await db.auditLog.create({
    data: {
      organizationId: entry.organizationId,
      actorUserId: entry.actorUserId,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      metadata: entry.metadata ?? undefined,
    },
  });
}
