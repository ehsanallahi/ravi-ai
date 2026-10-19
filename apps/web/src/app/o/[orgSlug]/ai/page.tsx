import { can } from "@ravi/core";
import { Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AccessDenied } from "@/components/layout/access-denied";
import { AiStatusBanner } from "@/components/layout/ai-status";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, statusLabel } from "@/lib/format";
import { getAiRuntime } from "@/server/ai/runtime";
import { getAiStatus, listSuggestions } from "@/server/data/ai";
import { requireTenant } from "@/server/tenancy/next";
import { AskForm } from "./ai-forms";

export const metadata: Metadata = { title: "AI playground" };

export default async function AiPlaygroundPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const ctx = await requireTenant(orgSlug);
  if (!can(ctx.role, "ai:configure")) {
    return (
      <>
        <PageHeader title="AI playground" />
        <AccessDenied what="test the AI assistant" />
      </>
    );
  }

  const { runtime, error } = getAiRuntime();
  const [status, suggestions] = await Promise.all([
    getAiStatus(ctx, runtime),
    listSuggestions(ctx),
  ]);
  const ready =
    status.configured && Boolean(status.usage.consentAt) && status.usage.remainingUsd > 0 && !error;

  return (
    <>
      <PageHeader
        title="AI playground"
        description="Test answers against your knowledge base. Nothing here is ever sent to WhatsApp."
      />

      <AiStatusBanner
        orgSlug={orgSlug}
        status={{
          configured: status.configured,
          configError: error,
          consentAt: status.usage.consentAt,
          remainingUsd: status.usage.remainingUsd,
          budgetUsd: status.usage.budgetUsd,
          monthToDateUsd: status.usage.monthToDateUsd,
        }}
      />

      <Card>
        <CardHeader>
          <CardTitle>Ask a question</CardTitle>
          <CardDescription>
            {status.models
              ? `Chat: ${status.models.chat} · Embeddings: ${status.models.embedding} (${status.models.dimensions} dimensions)`
              : "No model configured"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AskForm orgSlug={orgSlug} disabled={!ready} />
        </CardContent>
      </Card>

      {suggestions.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="No test answers yet"
          description="Ask a question to see the answer, the knowledge it used, and its cost."
        />
      ) : (
        <Card className="gap-0 py-0">
          <ul className="divide-y">
            {suggestions.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/o/${orgSlug}/ai/${s.id}`}
                  className="flex flex-col gap-1 px-4 py-3 hover:bg-muted/50 sm:flex-row sm:items-center sm:gap-4"
                >
                  <span className="min-w-0 flex-1 truncate" dir="auto">
                    {s.question}
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant={s.decision === "REPLY" ? "default" : "outline"}>
                      {s.decision === "REPLY" ? "Answered" : "Handed off"}
                    </Badge>
                    <Badge variant="secondary">{statusLabel(s.status)}</Badge>
                    {formatDateTime(s.createdAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
