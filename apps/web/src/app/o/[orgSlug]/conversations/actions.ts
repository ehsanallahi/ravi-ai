"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/components/ui/form";
import {
  assignConversation,
  disableConversationAi,
  setConversationStatus,
} from "@/server/data/conversations";
import { tenantAction } from "@/server/tenancy/next";

const idSchema = z.string().min(1).max(64);

export async function updateConversationAction(
  orgSlug: string,
  conversationId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return tenantAction(orgSlug, "conversations:reply", async (ctx) => {
    const id = idSchema.parse(conversationId);
    const intent = formData.get("intent");
    if (intent === "status") {
      const status = z.enum(["OPEN", "PENDING", "RESOLVED"]).parse(formData.get("status"));
      await setConversationStatus(ctx, id, status);
    } else if (intent === "assign") {
      const raw = String(formData.get("assignee") ?? "");
      await assignConversation(ctx, id, raw === "none" || raw === "" ? null : idSchema.parse(raw));
    } else if (intent === "disable-ai") {
      await disableConversationAi(ctx, id);
    } else {
      return { ok: false, error: "Unknown action" };
    }
    revalidatePath(`/o/${ctx.organizationSlug}/conversations/${id}`);
    revalidatePath(`/o/${ctx.organizationSlug}/conversations`);
    return { ok: true, message: "Saved" };
  });
}
