import { can } from "@ravi/core";
import { BookOpen } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime, statusLabel } from "@/lib/format";
import { listDocuments } from "@/server/data/knowledge";
import { requireTenant } from "@/server/tenancy/next";
import { NewDocumentForm } from "./knowledge-forms";

export const metadata: Metadata = { title: "Knowledge base" };

const STATUS_HINT: Record<string, string> = {
  DRAFT: "Not indexed",
  PROCESSING: "Indexing",
  READY: "Used for answers",
  FAILED: "Indexing failed",
  ARCHIVED: "Not used",
};

export default async function KnowledgePage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireTenant(orgSlug, "knowledge:read");
  const documents = await listDocuments(ctx);
  const canWrite = can(ctx.role, "knowledge:write");

  return (
    <>
      <PageHeader
        title="Knowledge base"
        description="Business information the AI may answer from. Only indexed (ready) documents are used, and nothing else."
      />

      {canWrite ? (
        <Card>
          <CardHeader>
            <CardTitle>Add knowledge</CardTitle>
            <CardDescription>
              Saved as a draft first. Indexing sends the text to Google Gemini to create embeddings,
              which requires the owner&apos;s AI data-processing consent in Settings.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <NewDocumentForm orgSlug={orgSlug} />
          </CardContent>
        </Card>
      ) : null}

      {documents.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="No documents yet"
          description="Without knowledge, the assistant hands every question to your team instead of guessing."
        />
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Chunks</TableHead>
                <TableHead className="hidden md:table-cell">Indexed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>
                    <Link
                      href={`/o/${orgSlug}/knowledge/${d.id}`}
                      className="font-medium hover:text-primary"
                    >
                      {d.title}
                    </Link>
                    {d.sourceFilename ? (
                      <p className="text-xs text-muted-foreground">{d.sourceFilename}</p>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Badge variant={d.status === "READY" ? "default" : "outline"}>
                      {statusLabel(d.status)}
                    </Badge>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {d.errorMessage ?? STATUS_HINT[d.status]}
                    </p>
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">
                    {d._count.chunks}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">
                    {formatDateTime(d.indexedAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}
