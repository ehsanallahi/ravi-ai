"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/components/ui/form";
import { setContactOptOut } from "@/server/data/contacts";
import { createLead } from "@/server/data/leads";
import { tenantAction } from "@/server/tenancy/next";

const idSchema = z.string().min(1).max(64);

export async function setOptOutAction(
  orgSlug: string,
  contactId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return tenantAction(orgSlug, "contacts:write", async (ctx) => {
    const optedOut = formData.get("optedOut") === "true";
    await setContactOptOut(ctx, idSchema.parse(contactId), optedOut);
    revalidatePath(`/o/${ctx.organizationSlug}/contacts/${contactId}`);
    return {
      ok: true,
      message: optedOut ? "Contact opted out of automated messages" : "Opt-out removed",
    };
  });
}

export async function createLeadAction(
  orgSlug: string,
  contactId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let leadId: string | null = null;
  const result = await tenantAction(orgSlug, "leads:write", async (ctx) => {
    const lead = await createLead(ctx, idSchema.parse(contactId), {
      title: String(formData.get("title") ?? ""),
      status: (formData.get("status") as "NEW") ?? "NEW",
      notes: String(formData.get("notes") ?? ""),
      estimatedValue: String(formData.get("estimatedValue") ?? ""),
      currency: String(formData.get("currency") ?? ""),
    });
    leadId = lead.id;
    revalidatePath(`/o/${ctx.organizationSlug}/leads`);
  });
  if (result?.ok && leadId) redirect(`/o/${orgSlug}/leads/${leadId}`);
  return result;
}
