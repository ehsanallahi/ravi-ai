"use server";

import { extractDocumentText } from "@ravi/knowledge/extract";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/components/ui/form";
import { getAiRuntime } from "@/server/ai/runtime";
import { createDocument, indexDocument, setDocumentArchived } from "@/server/data/knowledge";
import { tenantAction } from "@/server/tenancy/next";

const idSchema = z.string().min(1).max(64);

export async function createDocumentAction(
  orgSlug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let createdId: string | null = null;
  const result = await tenantAction(orgSlug, "knowledge:write", async (ctx) => {
    const title = String(formData.get("title") ?? "");
    const file = formData.get("file");
    let doc;
    if (file instanceof File && file.size > 0) {
      // Extracted on the server; the type is checked by signature, not the browser's claim.
      const { text } = await extractDocumentText(
        file.name,
        new Uint8Array(await file.arrayBuffer()),
      );
      doc = await createDocument(ctx, {
        title,
        content: text,
        sourceFilename: file.name,
        sourceType: "FILE",
      });
    } else {
      doc = await createDocument(ctx, {
        title,
        content: String(formData.get("content") ?? ""),
        sourceType: "MANUAL",
      });
    }
    createdId = doc.id;
    revalidatePath(`/o/${ctx.organizationSlug}/knowledge`);
  });
  if (result?.ok && createdId) redirect(`/o/${orgSlug}/knowledge/${createdId}`);
  return result;
}

export async function indexDocumentAction(
  orgSlug: string,
  documentId: string,
  _prev: ActionState,
): Promise<ActionState> {
  return tenantAction(orgSlug, "knowledge:write", async (ctx) => {
    const { runtime, error } = getAiRuntime();
    if (!runtime) return { ok: false, error: error ?? "AI is not configured" };
    const { chunks } = await indexDocument(ctx, runtime, idSchema.parse(documentId));
    revalidatePath(`/o/${ctx.organizationSlug}/knowledge`);
    revalidatePath(`/o/${ctx.organizationSlug}/knowledge/${documentId}`);
    return {
      ok: true,
      message: `Indexed ${chunks} chunk${chunks === 1 ? "" : "s"} with ${runtime.models.embedding}.`,
    };
  });
}

export async function archiveDocumentAction(
  orgSlug: string,
  documentId: string,
  archived: boolean,
  _prev: ActionState,
): Promise<ActionState> {
  return tenantAction(orgSlug, "knowledge:write", async (ctx) => {
    await setDocumentArchived(ctx, idSchema.parse(documentId), archived);
    revalidatePath(`/o/${ctx.organizationSlug}/knowledge`);
    revalidatePath(`/o/${ctx.organizationSlug}/knowledge/${documentId}`);
    return {
      ok: true,
      message: archived ? "Archived. It is no longer used for answers." : "Restored.",
    };
  });
}
