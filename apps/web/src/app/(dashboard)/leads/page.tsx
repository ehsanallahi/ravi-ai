import { Target } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = { title: "Leads" };

export default function LeadsPage() {
  return (
    <>
      <PageHeader title="Leads" description="Sales opportunities captured from conversations." />
      <EmptyState
        icon={Target}
        title="No leads yet"
        description="The lead pipeline (New → Contacted → Qualified → Won/Lost) is modelled in the database. The board UI arrives in Phase 4."
      />
    </>
  );
}
