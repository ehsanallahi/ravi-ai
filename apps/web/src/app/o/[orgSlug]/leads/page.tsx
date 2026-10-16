import { Target } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { contactName, formatDate, formatMoney, statusLabel } from "@/lib/format";
import { LEAD_STATUSES, listLeads } from "@/server/data/leads";
import { requireTenant } from "@/server/tenancy/next";

export const metadata: Metadata = { title: "Leads" };

export default async function LeadsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { orgSlug } = await params;
  const sp = await searchParams;
  const ctx = await requireTenant(orgSlug, "leads:read");
  const status = LEAD_STATUSES.find((s) => s === sp.status);
  const leads = await listLeads(ctx, { status });

  return (
    <>
      <PageHeader
        title="Leads"
        description="Sales opportunities. Create a lead from a contact's page."
      />

      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm" variant={!status ? "default" : "outline"}>
          <Link href={`/o/${orgSlug}/leads`}>All</Link>
        </Button>
        {LEAD_STATUSES.map((s) => (
          <Button key={s} asChild size="sm" variant={status === s ? "default" : "outline"}>
            <Link href={`/o/${orgSlug}/leads?status=${s}`}>{statusLabel(s)}</Link>
          </Button>
        ))}
      </div>

      {leads.length === 0 ? (
        <EmptyState
          icon={Target}
          title={status ? `No ${statusLabel(status).toLowerCase()} leads` : "No leads yet"}
          description="Open a contact and use “New lead” to start tracking an opportunity."
        />
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lead</TableHead>
                <TableHead className="hidden sm:table-cell">Contact</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden text-right md:table-cell">Value</TableHead>
                <TableHead className="hidden md:table-cell">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>
                    <Link
                      href={`/o/${orgSlug}/leads/${l.id}`}
                      className="font-medium hover:text-primary"
                    >
                      {l.title ?? "Untitled lead"}
                    </Link>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">
                    {contactName(l.contact)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{statusLabel(l.status)}</Badge>
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">
                    {formatMoney(l.estimatedValue, l.currency)}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">
                    {formatDate(l.updatedAt)}
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
