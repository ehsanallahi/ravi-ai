import { BookOpen } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { requireTenant } from "@/server/tenancy/next";

export const metadata: Metadata = { title: "Knowledge base" };

export default async function KnowledgePage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  await requireTenant(orgSlug, "knowledge:read");
  return (
    <>
      <PageHeader
        title="Knowledge base"
        description="Business information the AI assistant may answer from."
      />
      <EmptyState
        icon={BookOpen}
        title="Document management arrives in Phase 3"
        description="The assistant will only answer from documents your team adds here. Until then, AI replies stay off."
      />
    </>
  );
}
