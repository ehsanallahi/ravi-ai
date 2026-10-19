"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { type ActionState, FormMessage, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { archiveDocumentAction, createDocumentAction, indexDocumentAction } from "./actions";

export function NewDocumentForm({ orgSlug }: { orgSlug: string }) {
  const [mode, setMode] = useState<"paste" | "upload">("paste");
  const [state, action] = useActionState<ActionState, FormData>(
    createDocumentAction.bind(null, orgSlug),
    null,
  );
  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          name="title"
          required
          minLength={2}
          maxLength={200}
          placeholder="e.g. Prices and delivery"
        />
      </div>
      <div className="flex gap-2" role="tablist" aria-label="Content source">
        <Button
          type="button"
          size="sm"
          variant={mode === "paste" ? "default" : "outline"}
          onClick={() => setMode("paste")}
        >
          Paste text
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === "upload" ? "default" : "outline"}
          onClick={() => setMode("upload")}
        >
          Upload file
        </Button>
      </div>
      {mode === "paste" ? (
        <div className="space-y-1.5">
          <Label htmlFor="content">Business information</Label>
          <Textarea
            id="content"
            name="content"
            rows={10}
            required
            placeholder={
              "Products, prices, delivery areas, opening hours, return policy…\nEnglish, اردو and Roman Urdu are supported."
            }
          />
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="file">File (.txt, .md or .pdf, up to 5 MB)</Label>
          <Input
            id="file"
            name="file"
            type="file"
            required
            accept=".txt,.md,.markdown,.pdf,text/plain,text/markdown,application/pdf"
          />
          <p className="text-xs text-muted-foreground">
            Text is extracted on the server. Scanned PDFs without a text layer are not supported.
          </p>
        </div>
      )}
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Saving…">Save as draft</SubmitButton>
    </form>
  );
}

export function IndexDocumentButton({
  orgSlug,
  documentId,
  label,
}: {
  orgSlug: string;
  documentId: string;
  label: string;
}) {
  const [state, action] = useActionState<ActionState>(
    indexDocumentAction.bind(null, orgSlug, documentId),
    null,
  );
  return (
    <form action={action} className="space-y-2">
      <SubmitButton pendingLabel="Indexing…">{label}</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function ArchiveDocumentButton({
  orgSlug,
  documentId,
  archived,
}: {
  orgSlug: string;
  documentId: string;
  archived: boolean;
}) {
  const [state, action] = useActionState<ActionState>(
    archiveDocumentAction.bind(null, orgSlug, documentId, !archived),
    null,
  );
  return (
    <form action={action} className="space-y-2">
      <SubmitButton variant="outline">{archived ? "Restore" : "Archive"}</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
