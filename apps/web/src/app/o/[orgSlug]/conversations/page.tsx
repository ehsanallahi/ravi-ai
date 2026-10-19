import { MessagesSquare } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { contactName, formatDateTime, statusLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { listConversations } from "@/server/data/conversations";
import { requireTenant } from "@/server/tenancy/next";

export const metadata: Metadata = { title: "Conversations" };

const FILTERS = [
  { label: "All", value: undefined },
  { label: "Open", value: "OPEN" },
  { label: "Needs a human", value: "PENDING" },
  { label: "Resolved", value: "RESOLVED" },
] as const;

type Status = (typeof FILTERS)[number]["value"];

export default async function ConversationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ status?: string; mine?: string; cursor?: string }>;
}) {
  const { orgSlug } = await params;
  const sp = await searchParams;
  const ctx = await requireTenant(orgSlug, "conversations:read");
  const status = FILTERS.find((f) => f.value === sp.status)?.value as Status;
  const mine = sp.mine === "1";
  const { items, nextCursor } = await listConversations(ctx, {
    status,
    assignedToMe: mine,
    cursor: typeof sp.cursor === "string" && sp.cursor.length < 64 ? sp.cursor : undefined,
  });

  const href = (next: { status?: string; mine?: boolean; cursor?: string }) => {
    const q = new URLSearchParams();
    if (next.status) q.set("status", next.status);
    if (next.mine) q.set("mine", "1");
    if (next.cursor) q.set("cursor", next.cursor);
    const s = q.toString();
    return `/o/${orgSlug}/conversations${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <PageHeader title="Conversations" description="WhatsApp threads with your customers." />

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f.label}
            asChild
            size="sm"
            variant={status === f.value ? "default" : "outline"}
          >
            <Link href={href({ status: f.value, mine })}>{f.label}</Link>
          </Button>
        ))}
        <Button asChild size="sm" variant={mine ? "default" : "outline"} className="sm:ml-auto">
          <Link href={href({ status, mine: !mine })}>Assigned to me</Link>
        </Button>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={MessagesSquare}
          title="No conversations here"
          description="Conversations are created automatically when a customer messages your connected WhatsApp number."
        />
      ) : (
        <Card className="gap-0 py-0">
          <ul className="divide-y">
            {items.map((c) => {
              const last = c.messages[0];
              return (
                <li key={c.id}>
                  <Link
                    href={`/o/${orgSlug}/conversations/${c.id}`}
                    className="flex flex-col gap-1 px-4 py-3 transition-colors hover:bg-muted/50 sm:flex-row sm:items-center sm:gap-4"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{contactName(c.contact)}</p>
                      <p className="truncate text-sm text-muted-foreground">
                        {last
                          ? `${last.direction === "OUTBOUND" ? "You: " : ""}${last.body ?? `[${last.type.toLowerCase()}]`}`
                          : "No messages"}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                      {c.assignedUser ? <span>→ {c.assignedUser.name}</span> : null}
                      <Badge
                        variant="outline"
                        className={cn(
                          c.status === "PENDING" &&
                            "border-amber-500/50 text-amber-700 dark:text-amber-400",
                        )}
                      >
                        {c.status === "PENDING" ? "Needs a human" : statusLabel(c.status)}
                      </Badge>
                      <span>{formatDateTime(c.lastMessageAt)}</span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {nextCursor ? (
        <div className="flex justify-center">
          <Button asChild variant="outline">
            <Link href={href({ status, mine, cursor: nextCursor })}>Load more</Link>
          </Button>
        </div>
      ) : null}
    </>
  );
}
