"use server";

import { redirect } from "next/navigation";
import type { ActionState } from "@/components/ui/form";
import { getCurrentSession } from "@/server/auth/session";
import { acceptInvitationAsNewUser, acceptInvitationAsUser } from "@/server/services/invitations";
import { errorToState } from "@/server/tenancy/next";

export async function acceptAsNewUserAction(
  token: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const password = String(formData.get("password") ?? "");
  if (password !== String(formData.get("confirm") ?? ""))
    return { ok: false, error: "Passwords do not match." };
  try {
    await acceptInvitationAsNewUser(token, { name: String(formData.get("name") ?? ""), password });
  } catch (err) {
    return errorToState(err);
  }
  redirect("/login?invited=1");
}

export async function acceptAsCurrentUserAction(
  token: string,
  _prev: ActionState,
): Promise<ActionState> {
  const session = await getCurrentSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
  let slug: string;
  try {
    ({ organizationSlug: slug } = await acceptInvitationAsUser(token, {
      id: session.user.id,
      email: session.user.email,
    }));
  } catch (err) {
    return errorToState(err);
  }
  redirect(`/o/${slug}`);
}
