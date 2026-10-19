"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/ui/form";
import { updateOrganizationSettings } from "@/server/services/organizations";
import { tenantAction } from "@/server/tenancy/next";

export async function updateSettingsAction(
  orgSlug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return tenantAction(orgSlug, "settings:manage", async (ctx) => {
    await updateOrganizationSettings(ctx, {
      name: String(formData.get("name") ?? ""),
      timezone: String(formData.get("timezone") ?? ""),
    });
    revalidatePath(`/o/${ctx.organizationSlug}`, "layout");
    return { ok: true, message: "Settings saved" };
  });
}
