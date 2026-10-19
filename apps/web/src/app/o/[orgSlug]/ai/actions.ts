"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/components/ui/form";
import { getAiRuntime } from "@/server/ai/runtime";
import { askPlayground, reviewSuggestion } from "@/server/data/ai";
import { tenantAction } from "@/server/tenancy/next";

export async function askAction(
  orgSlug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let suggestionId: string | null = null;
  const result = await tenantAction(orgSlug, "ai:configure", async (ctx) => {
    const { runtime, error } = getAiRuntime();
    if (!runtime) return { ok: false, error: error ?? "AI is not configured" };
    ({ suggestionId } = await askPlayground(ctx, runtime, String(formData.get("question") ?? "")));
    revalidatePath(`/o/${ctx.organizationSlug}/ai`);
  });
  if (result?.ok && suggestionId) redirect(`/o/${orgSlug}/ai/${suggestionId}`);
  return result;
}

export async function reviewAction(
  orgSlug: string,
  suggestionId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return tenantAction(orgSlug, "ai:configure", async (ctx) => {
    const rating = formData.get("rating");
    await reviewSuggestion(ctx, z.string().min(1).max(64).parse(suggestionId), {
      status: z.enum(["APPROVED", "REJECTED"]).parse(formData.get("status")),
      rating: rating ? Number(rating) : undefined,
      notes: String(formData.get("notes") ?? ""),
    });
    revalidatePath(`/o/${ctx.organizationSlug}/ai`);
    revalidatePath(`/o/${ctx.organizationSlug}/ai/${suggestionId}`);
    return { ok: true, message: "Review saved. Nothing was sent to the customer." };
  });
}
