import { can } from "@ravi/core";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { contactName, formatDateTime } from "@/lib/format";
import { getLead } from "@/server/data/leads";
import { requireTenant } from "@/server/tenancy/next";
import { LeadForm } from "./lead-form";

export const metadata: Metadata = { title: "Lead" };

export default async function LeadPage({
  params,
}: {
  params: Promise<{ orgSlug: string; leadId: string }>;
}) {
  const { orgSlug, leadId } = await params;
  const ctx = await requireTenant(orgSlug, "leads:read");
  const lead = await getLead(ctx, leadId);
  if (!lead) notFound();

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
        <Link href={`/o/${orgSlug}/leads`}>
          <ArrowLeft /> All leads
        </Link>
      </Button>
      <PageHeader
        title={lead.title ?? "Untitled lead"}
        description={`Created ${formatDateTime(lead.createdAt)} · updated ${formatDateTime(lead.updatedAt)}`}
      />
      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
          <CardDescription>
            Contact:{" "}
            <Link
              href={`/o/${orgSlug}/contacts/${lead.contact.id}`}
              className="text-primary hover:underline"
            >
              {contactName(lead.contact)}
            </Link>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LeadForm
            orgSlug={orgSlug}
            readOnly={!can(ctx.role, "leads:write")}
            lead={{
              id: lead.id,
              title: lead.title,
              status: lead.status,
              notes: lead.notes,
              estimatedValue: lead.estimatedValue?.toString() ?? null,
              currency: lead.currency,
            }}
          />
        </CardContent>
      </Card>
    </>
  );
}
