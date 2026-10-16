import { BookOpen } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = { title: "Knowledge base" };

export default function KnowledgePage() {
  return (
    <>
      <PageHeader
        title="Knowledge base"
        description="Business information the AI assistant is allowed to answer from."
      />
      <EmptyState
        icon={BookOpen}
        title="No documents yet"
        description="The assistant only answers from documents you add here. Without them, it hands conversations to your team instead of guessing. Document upload arrives in Phase 3."
      />
    </>
  );
}
