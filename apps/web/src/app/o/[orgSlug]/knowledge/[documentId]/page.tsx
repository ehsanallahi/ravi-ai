import { can } from "@ravi/core";
import { AlertCircle, ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, statusLabel } from "@/lib/format";
import { getDocument } from "@/server/data/knowledge";
import { requireTenant } from "@/server/tenancy/next";
import { ArchiveDocumentButton, IndexDocumentButton } from "../knowledge-forms";

export const metadata: Metadata = { title: "Knowledge document" };

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ orgSlug: string; documentId: string }>;
}) {
  const { orgSlug, documentId } = await params;
  const ctx = await requireTenant(orgSlug, "knowledge:read");
  const doc = await getDocument(ctx, documentId);
  if (!doc) notFound();
  const canWrite = can(ctx.role, "knowledge:write");
  const archived = doc.status === "ARCHIVED";

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
        <Link href={`/o/${orgSlug}/knowledge`}>
          <ArrowLeft /> Knowledge base
        </Link>
      </Button>
      <PageHeader
        title={doc.title}
        description={`${doc.sourceFilename ?? "Pasted text"} · added ${formatDateTime(doc.createdAt)}${doc.createdBy?.name ? ` by ${doc.createdBy.name}` : ""}`}
        actions={
          <Badge variant={doc.status === "READY" ? "default" : "outline"}>
            {statusLabel(doc.status)}
          </Badge>
        }
      />

      {doc.errorMessage ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{doc.errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <Card>
          <CardHeader>
            <CardTitle>Chunks ({doc.chunks.length})</CardTitle>
            <CardDescription>
              {doc.indexedAt
                ? `Indexed ${formatDateTime(doc.indexedAt)} with ${doc.embeddingModel}. These are the passages retrieval can return.`
                : "Not indexed yet. Index the document to make it available to the assistant."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {doc.chunks.length > 0 ? (
              <ol className="space-y-3">
                {doc.chunks.map((c) => (
                  <li key={c.id} className="rounded-lg border p-3 text-sm">
                    <p className="mb-1 text-xs text-muted-foreground">
                      Chunk {c.index + 1} · ~{c.tokenEstimate} tokens
                    </p>
                    <p className="whitespace-pre-wrap" dir="auto">
                      {c.content}
                    </p>
                  </li>
                ))}
              </ol>
            ) : (
              <pre
                className="max-h-[32rem] overflow-auto rounded-lg bg-muted/50 p-3 text-sm whitespace-pre-wrap"
                dir="auto"
              >
                {doc.content}
              </pre>
            )}
          </CardContent>
        </Card>

        {canWrite ? (
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>Actions</CardTitle>
              <CardDescription>
                Indexing sends this text to Google Gemini for embeddings (usage is metered).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!archived ? (
                <IndexDocumentButton
                  orgSlug={orgSlug}
                  documentId={doc.id}
                  label={doc.indexedAt ? "Re-index" : "Index now"}
                />
              ) : null}
              <ArchiveDocumentButton orgSlug={orgSlug} documentId={doc.id} archived={archived} />
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
