import { MessagesSquare, Phone, Target, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { contactName, formatDateTime, statusLabel } from "@/lib/format";
import { getOverviewStats, getRecentConversations } from "@/server/data/overview";
import { requireTenant } from "@/server/tenancy/next";

export const metadata: Metadata = { title: "Overview" };

export default async function OverviewPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireTenant(orgSlug, "conversations:read");
  const [stats, recent] = await Promise.all([getOverviewStats(ctx), getRecentConversations(ctx)]);

  const cards = [
    {
      label: "Open conversations",
      value: stats.conversations.open,
      hint: `${stats.conversations.pending} waiting for a human`,
      icon: MessagesSquare,
    },
    { label: "Contacts", value: stats.contacts, hint: "People who messaged you", icon: Users },
    {
      label: "Active leads",
      value: stats.leads.active,
      hint: `${stats.leads.won} won · ${stats.leads.lost} lost`,
      icon: Target,
    },
    {
      label: "Messages (7 days)",
      value: stats.messages7d.inbound + stats.messages7d.outbound,
      hint: `${stats.messages7d.inbound} received · ${stats.messages7d.outbound} sent`,
      icon: Phone,
    },
  ];

  return (
    <>
      <PageHeader
        title="Overview"
        description={`Activity for ${ctx.organizationName}. Figures are live counts from your data.`}
      />

      <section
        aria-label="Key metrics"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        {cards.map(({ label, value, hint, icon: Icon }) => (
          <Card key={label}>
            <CardHeader className="flex-row items-center justify-between">
              <CardDescription>{label}</CardDescription>
              <Icon className="size-4 text-muted-foreground" aria-hidden />
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold tabular-nums">{value.toLocaleString("en")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      {stats.whatsappAccounts === 0 ? (
        <EmptyState
          icon={Phone}
          title="No WhatsApp number connected"
          description="Register your Cloud API phone number with the account:register script (see README). Then messages sent to it appear here."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Recent conversations</CardTitle>
            <CardDescription>The latest threads with your customers.</CardDescription>
          </CardHeader>
          <CardContent>
            {recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No conversations yet. They appear as soon as a customer messages your number.
              </p>
            ) : (
              <ul className="divide-y">
                {recent.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/o/${orgSlug}/conversations/${c.id}`}
                      className="flex items-center justify-between gap-3 py-3 hover:text-primary"
                    >
                      <span className="truncate font-medium">{contactName(c.contact)}</span>
                      <span className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                        <Badge variant="outline">{statusLabel(c.status)}</Badge>
                        {formatDateTime(c.lastMessageAt)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}
