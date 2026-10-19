import { can } from "@ravi/core";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { contactName, formatDate, formatDateTime, statusLabel } from "@/lib/format";
import { getContact } from "@/server/data/contacts";
import { requireTenant } from "@/server/tenancy/next";
import { CreateLeadForm, OptOutForm } from "./contact-forms";

export const metadata: Metadata = { title: "Contact" };

export default async function ContactPage({
  params,
}: {
  params: Promise<{ orgSlug: string; contactId: string }>;
}) {
  const { orgSlug, contactId } = await params;
  const ctx = await requireTenant(orgSlug, "contacts:read");
  const contact = await getContact(ctx, contactId);
  if (!contact) notFound();

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
        <Link href={`/o/${orgSlug}/contacts`}>
          <ArrowLeft /> All contacts
        </Link>
      </Button>
      <PageHeader
        title={contactName(contact)}
        description={`+${contact.waId} · first seen ${formatDate(contact.createdAt)}`}
        actions={contact.optedOutAt ? <Badge variant="outline">Opted out</Badge> : null}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Conversations</CardTitle>
          </CardHeader>
          <CardContent>
            {contact.conversations.length === 0 ? (
              <p className="text-sm text-muted-foreground">No conversations.</p>
            ) : (
              <ul className="divide-y text-sm">
                {contact.conversations.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/o/${orgSlug}/conversations/${c.id}`}
                      className="flex justify-between py-2 hover:text-primary"
                    >
                      <span>{statusLabel(c.status)}</span>
                      <span className="text-muted-foreground">
                        {formatDateTime(c.lastMessageAt)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Leads</CardTitle>
          </CardHeader>
          <CardContent>
            {contact.leads.length === 0 ? (
              <p className="text-sm text-muted-foreground">No leads for this contact.</p>
            ) : (
              <ul className="divide-y text-sm">
                {contact.leads.map((l) => (
                  <li key={l.id}>
                    <Link
                      href={`/o/${orgSlug}/leads/${l.id}`}
                      className="flex justify-between gap-2 py-2 hover:text-primary"
                    >
                      <span className="truncate">{l.title ?? "Untitled lead"}</span>
                      <Badge variant="outline">{statusLabel(l.status)}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {can(ctx.role, "leads:write") ? (
          <Card>
            <CardHeader>
              <CardTitle>New lead</CardTitle>
              <CardDescription>Track a sales opportunity with this contact.</CardDescription>
            </CardHeader>
            <CardContent>
              <CreateLeadForm orgSlug={orgSlug} contactId={contact.id} />
            </CardContent>
          </Card>
        ) : null}

        {can(ctx.role, "contacts:write") ? (
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>Messaging consent</CardTitle>
            </CardHeader>
            <CardContent>
              <OptOutForm
                orgSlug={orgSlug}
                contactId={contact.id}
                optedOut={Boolean(contact.optedOutAt)}
              />
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
