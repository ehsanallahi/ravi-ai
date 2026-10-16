"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/components/ui/form";
import { LEAD_STATUSES, updateLead } from "@/server/data/leads";
import { tenantAction } from "@/server/tenancy/next";

export async function updateLeadAction(
  orgSlug: string,
  leadId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return tenantAction(orgSlug, "leads:write", async (ctx) => {
    const id = z.string().min(1).max(64).parse(leadId);
    await updateLead(ctx, id, {
      title: String(formData.get("title") ?? ""),
      status: z.enum(LEAD_STATUSES).parse(formData.get("status")),
      notes: String(formData.get("notes") ?? ""),
      estimatedValue: String(formData.get("estimatedValue") ?? ""),
      currency: String(formData.get("currency") ?? ""),
    });
    revalidatePath(`/o/${ctx.organizationSlug}/leads`);
    revalidatePath(`/o/${ctx.organizationSlug}/leads/${id}`);
    return { ok: true, message: "Lead saved" };
  });
}
