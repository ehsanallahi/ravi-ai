"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/components/ui/form";
import { getAuthEnv } from "@/server/auth/auth";
import { createEmailSender } from "@/server/email";
import { createInvitation, revokeInvitation } from "@/server/services/invitations";
import { changeMemberRole, removeMember, roleSchema } from "@/server/services/members";
import { tenantAction } from "@/server/tenancy/next";

const idSchema = z.string().min(1).max(64);

export async function inviteMemberAction(
  orgSlug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return tenantAction(orgSlug, "members:manage", async (ctx) => {
    const env = getAuthEnv();
    const { url } = await createInvitation(
      ctx,
      { email: String(formData.get("email") ?? ""), role: roleSchema.parse(formData.get("role")) },
      { email: createEmailSender(env), baseUrl: env.BETTER_AUTH_URL },
    );
    revalidatePath(`/o/${ctx.organizationSlug}/team`);
    // Locally (outbox adapter, nothing is emailed) the link is shown once so it can be tested.
    return {
      ok: true,
      message:
        env.EMAIL_PROVIDER === "outbox"
          ? `Invitation created. Local outbox only, nothing was emailed. Link: ${url}`
          : "Invitation sent.",
    };
  });
}

export async function revokeInvitationAction(
  orgSlug: string,
  invitationId: string,
  _prev: ActionState,
): Promise<ActionState> {
  return tenantAction(orgSlug, "members:manage", async (ctx) => {
    await revokeInvitation(ctx, idSchema.parse(invitationId));
    revalidatePath(`/o/${ctx.organizationSlug}/team`);
    return { ok: true, message: "Invitation revoked" };
  });
}

export async function changeRoleAction(
  orgSlug: string,
  membershipId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return tenantAction(orgSlug, "members:manage", async (ctx) => {
    await changeMemberRole(
      ctx,
      idSchema.parse(membershipId),
      roleSchema.parse(formData.get("role")),
    );
    revalidatePath(`/o/${ctx.organizationSlug}/team`);
    return { ok: true, message: "Role updated" };
  });
}

export async function removeMemberAction(
  orgSlug: string,
  membershipId: string,
  isSelf: boolean,
  _prev: ActionState,
): Promise<ActionState> {
  // Leaving needs no extra permission; removing others is checked inside removeMember.
  const result = await tenantAction(orgSlug, undefined, async (ctx) => {
    await removeMember(ctx, idSchema.parse(membershipId));
    revalidatePath(`/o/${ctx.organizationSlug}/team`);
    return { ok: true, message: "Member removed" };
  });
  if (result?.ok && isSelf) redirect("/dashboard");
  return result;
}
