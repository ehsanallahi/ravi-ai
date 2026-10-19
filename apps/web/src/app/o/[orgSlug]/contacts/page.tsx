import { Search, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { contactName, formatDateTime } from "@/lib/format";
import { listContacts } from "@/server/data/contacts";
import { requireTenant } from "@/server/tenancy/next";

export const metadata: Metadata = { title: "Contacts" };

export default async function ContactsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ q?: string; cursor?: string }>;
}) {
  const { orgSlug } = await params;
  const sp = await searchParams;
  const ctx = await requireTenant(orgSlug, "contacts:read");
  const q = typeof sp.q === "string" ? sp.q.slice(0, 100) : "";
  const { items, nextCursor } = await listContacts(ctx, {
    q,
    cursor: typeof sp.cursor === "string" && sp.cursor.length < 64 ? sp.cursor : undefined,
  });

  return (
    <>
      <PageHeader title="Contacts" description="People who have messaged your WhatsApp number." />

      <form className="flex max-w-md gap-2" role="search">
        <Input
          name="q"
          defaultValue={q}
          placeholder="Search by name or number"
          aria-label="Search contacts"
        />
        <Button type="submit" variant="outline" size="icon" aria-label="Search">
          <Search />
        </Button>
      </form>

      {items.length === 0 ? (
        <EmptyState
          icon={Users}
          title={q ? "No matching contacts" : "No contacts yet"}
          description={
            q
              ? "Try a different name or number."
              : "Contacts are created automatically from real inbound WhatsApp messages. Nothing is imported or invented."
          }
        />
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="hidden sm:table-cell">WhatsApp</TableHead>
                <TableHead className="hidden md:table-cell">Last message</TableHead>
                <TableHead className="text-right">Leads</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link
                      href={`/o/${orgSlug}/contacts/${c.id}`}
                      className="font-medium hover:text-primary"
                    >
                      {contactName(c)}
                    </Link>
                    {c.optedOutAt ? (
                      <Badge variant="outline" className="ml-2">
                        Opted out
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">
                    +{c.waId}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">
                    {formatDateTime(c.lastInboundAt)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{c._count.leads}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {nextCursor ? (
        <div className="flex justify-center">
          <Button asChild variant="outline">
            <Link
              href={`/o/${orgSlug}/contacts?${new URLSearchParams({ ...(q ? { q } : {}), cursor: nextCursor })}`}
            >
              Load more
            </Link>
          </Button>
        </div>
      ) : null}
    </>
  );
}
