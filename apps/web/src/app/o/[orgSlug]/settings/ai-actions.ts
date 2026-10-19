"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/ui/form";
import { getAiRuntime } from "@/server/ai/runtime";
import { setAiBudget, setAiConsent } from "@/server/data/ai";
import { tenantAction } from "@/server/tenancy/next";

export async function aiConsentAction(
  orgSlug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return tenantAction(orgSlug, "org:manage", async (ctx) => {
    const grant = formData.get("grant") === "true";
    if (grant && formData.get("acknowledge") !== "on") {
      return { ok: false, error: "Confirm that you have read how data is processed." };
    }
    await setAiConsent(ctx, grant);
    revalidatePath(`/o/${ctx.organizationSlug}`, "layout");
    return {
      ok: true,
      message: grant
        ? "AI data processing enabled."
        : "AI data processing turned off. No further data will be sent.",
    };
  });
}

export async function aiBudgetAction(
  orgSlug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return tenantAction(orgSlug, "org:manage", async (ctx) => {
    const raw = String(formData.get("budget") ?? "").trim();
    const platform = getAiRuntime().runtime?.limits.monthlyBudgetUsd ?? 0;
    await setAiBudget(ctx, raw === "" ? null : Number(raw), platform);
    revalidatePath(`/o/${ctx.organizationSlug}/settings`);
    return { ok: true, message: "Budget saved." };
  });
}
