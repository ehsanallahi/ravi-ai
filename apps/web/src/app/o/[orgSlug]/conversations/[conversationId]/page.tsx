import { can } from "@ravi/core";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { contactName, formatDateTime, statusLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { listConversationDrafts } from "@/server/data/ai";
import { getConversation } from "@/server/data/conversations";
import { listMembers } from "@/server/services/members";
import { requireTenant } from "@/server/tenancy/next";
import { ConversationControls } from "./conversation-controls";

export const metadata: Metadata = { title: "Conversation" };

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ orgSlug: string; conversationId: string }>;
}) {
  const { orgSlug, conversationId } = await params;
  const ctx = await requireTenant(orgSlug, "conversations:read");
  const conversation = await getConversation(ctx, conversationId);
  // Missing and other-tenant conversations look identical.
  if (!conversation) notFound();
  const canReply = can(ctx.role, "conversations:reply");
  const members = canReply ? await listMembers(ctx) : [];
  const drafts = await listConversationDrafts(ctx, conversation.id);
  const canReview = can(ctx.role, "ai:configure");

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
        <Link href={`/o/${orgSlug}/conversations`}>
          <ArrowLeft /> All conversations
        </Link>
      </Button>
      <PageHeader
        title={contactName(conversation.contact)}
        description={`+${conversation.contact.waId}${conversation.whatsappAccount.displayPhoneNumber ? ` · via ${conversation.whatsappAccount.displayPhoneNumber}` : ""}`}
        actions={<Badge variant="outline">{statusLabel(conversation.status)}</Badge>}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Messages</CardTitle>
              <CardDescription>
                Most recent 100 messages. Replying from the dashboard arrives in Phase 3.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {conversation.messages.length === 0 ? (
                <p className="text-sm text-muted-foreground">No messages yet.</p>
              ) : (
                <ol className="space-y-3">
                  {conversation.messages.map((m) => {
                    const outbound = m.direction === "OUTBOUND";
                    return (
                      <li
                        key={m.id}
                        className={cn("flex", outbound ? "justify-end" : "justify-start")}
                      >
                        <div
                          className={cn(
                            "max-w-[85%] rounded-xl px-3 py-2 text-sm",
                            outbound ? "bg-primary text-primary-foreground" : "bg-muted",
                          )}
                        >
                          {/* Rendered as text: React escapes customer content. */}
                          <p className="break-words whitespace-pre-wrap">
                            {m.body ?? `[${m.type.toLowerCase()} message]`}
                          </p>
                          <p
                            className={cn(
                              "mt-1 text-[11px]",
                              outbound ? "text-primary-foreground/75" : "text-muted-foreground",
                            )}
                          >
                            {formatDateTime(m.createdAt)}
                            {outbound
                              ? ` · ${m.senderType === "AI" ? "AI" : "Team"} · ${statusLabel(m.status)}`
                              : ""}
                            {m.errorMessage ? ` · ${m.errorMessage}` : ""}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>AI drafts</CardTitle>
              <CardDescription>
                Suggested replies written by Gemini for review. Drafts are never sent to WhatsApp.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {drafts.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No drafts. Draft mode needs AI_DRAFT_REPLIES_ENABLED, AI consent and knowledge.
                </p>
              ) : (
                <ul className="space-y-3">
                  {drafts.map((d) => (
                    <li key={d.id} className="rounded-lg border p-3 text-sm">
                      <p className="text-muted-foreground">Customer: {d.question}</p>
                      <p className="mt-1 break-words whitespace-pre-wrap">
                        {d.decision === "REPLY"
                          ? d.answer
                          : `Handoff suggested (${d.handoffReason ?? "unknown"})`}
                      </p>
                      <p className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        {formatDateTime(d.createdAt)}
                        <Badge variant="secondary">{statusLabel(d.status)}</Badge>
                        {canReview ? (
                          <Link
                            className="text-primary hover:underline"
                            href={`/o/${orgSlug}/ai/${d.id}`}
                          >
                            Review
                          </Link>
                        ) : null}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <dl className="space-y-2">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Contact</dt>
                <dd>
                  <Link
                    className="text-primary hover:underline"
                    href={`/o/${orgSlug}/contacts/${conversation.contact.id}`}
                  >
                    View contact
                  </Link>
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Started</dt>
                <dd>{formatDateTime(conversation.createdAt)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Last customer message</dt>
                <dd>{formatDateTime(conversation.lastInboundAt)}</dd>
              </div>
              {conversation.contact.optedOutAt ? (
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Opted out</dt>
                  <dd>{formatDateTime(conversation.contact.optedOutAt)}</dd>
                </div>
              ) : null}
            </dl>
            {canReply ? (
              <ConversationControls
                orgSlug={orgSlug}
                conversationId={conversation.id}
                status={conversation.status}
                assignedUserId={conversation.assignedUser?.id ?? null}
                aiEnabled={conversation.aiEnabled}
                members={members.map((m) => ({ id: m.user.id, name: m.user.name ?? m.user.email }))}
              />
            ) : (
              <p className="text-muted-foreground">
                Your role can view but not change conversations.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
