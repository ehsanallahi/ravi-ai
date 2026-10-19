import { can } from "@ravi/core";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/layout/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, statusLabel } from "@/lib/format";
import { getSuggestion } from "@/server/data/ai";
import { requireTenant } from "@/server/tenancy/next";
import { ReviewForm } from "../ai-forms";

export const metadata: Metadata = { title: "AI answer" };

const HANDOFF_TEXT: Record<string, string> = {
  no_knowledge: "No relevant knowledge was found, so the AI was not asked. A human should answer.",
  human_requested: "The customer asked for a person.",
  model_handoff: "The AI decided a human should answer.",
  unsupported_claim:
    "The AI's draft contained a price, number or link that is not in your knowledge, so it was withheld.",
  refused: "The AI provider declined to answer (safety filter).",
  invalid_model_output: "The AI returned an unusable answer.",
  empty_reply: "The AI returned an empty answer.",
  no_customer_message: "There was no question to answer.",
};

export default async function SuggestionPage({
  params,
}: {
  params: Promise<{ orgSlug: string; suggestionId: string }>;
}) {
  const { orgSlug, suggestionId } = await params;
  const ctx = await requireTenant(orgSlug);
  if (!can(ctx.role, "ai:configure")) return <AccessDenied what="review AI answers" />;
  const s = await getSuggestion(ctx, suggestionId);
  if (!s) notFound();

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
        <Link href={`/o/${orgSlug}/ai`}>
          <ArrowLeft /> AI playground
        </Link>
      </Button>
      <PageHeader
        title="AI answer"
        description={`${formatDateTime(s.createdAt)}${s.model ? ` · ${s.model}` : ""} · ${s.latencyMs} ms · est. $${Number(s.estimatedCostUsd).toFixed(6)}`}
        actions={<Badge variant="secondary">{statusLabel(s.status)}</Badge>}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardDescription>Customer question</CardDescription>
              <CardTitle className="leading-snug font-medium" dir="auto">
                {s.question}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {s.decision === "REPLY" ? (
                <div className="rounded-xl bg-primary/10 p-4">
                  <p className="mb-1 text-xs font-medium text-primary">
                    Suggested reply{s.language ? ` · ${s.language.replace("_", " ")}` : ""}
                  </p>
                  <p className="whitespace-pre-wrap" dir="auto">
                    {s.answer}
                  </p>
                </div>
              ) : (
                <Alert>
                  <ShieldAlert />
                  <AlertTitle>Handed off to a human</AlertTitle>
                  <AlertDescription>
                    {HANDOFF_TEXT[s.handoffReason ?? ""] ?? s.handoffReason}
                  </AlertDescription>
                </Alert>
              )}
              {s.withheldDraft ? (
                <div className="rounded-lg border border-dashed p-3 text-sm">
                  <p className="mb-1 text-xs font-medium text-destructive">
                    Withheld draft (never sent)
                  </p>
                  <p className="whitespace-pre-wrap" dir="auto">
                    {s.withheldDraft}
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Retrieved knowledge ({s.sources.length})</CardTitle>
              <CardDescription>
                Passages found by search for this question. “Cited” marks the ones the answer used.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {s.sources.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing relevant was found.</p>
              ) : (
                <ol className="space-y-3">
                  {s.sources.map((src, i) => (
                    <li key={src.chunkId} className="rounded-lg border p-3 text-sm">
                      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">
                          [{i + 1}]{" "}
                          <Link
                            href={`/o/${orgSlug}/knowledge/${src.documentId}`}
                            className="hover:underline"
                          >
                            {src.documentTitle}
                          </Link>
                        </span>
                        {src.cited ? <Badge>Cited</Badge> : null}
                        {typeof src.similarity === "number" ? (
                          <span>similarity {src.similarity.toFixed(3)}</span>
                        ) : null}
                      </div>
                      <p className="whitespace-pre-wrap" dir="auto">
                        {src.excerpt}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Evaluate</CardTitle>
            {s.reviewedAt ? (
              <CardDescription>Last reviewed {formatDateTime(s.reviewedAt)}</CardDescription>
            ) : null}
          </CardHeader>
          <CardContent>
            <ReviewForm
              orgSlug={orgSlug}
              suggestionId={s.id}
              current={{ rating: s.rating, notes: s.reviewNotes }}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
