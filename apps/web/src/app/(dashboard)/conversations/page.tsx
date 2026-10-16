import { MessagesSquare } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = { title: "Conversations" };

export default function ConversationsPage() {
  return (
    <>
      <PageHeader
        title="Conversations"
        description="WhatsApp threads with your customers, with AI and human replies."
      />
      <EmptyState
        icon={MessagesSquare}
        title="No conversations to show"
        description="Inbound messages are already stored by the webhook and worker. The live inbox, with manual replies and AI takeover controls, arrives in Phase 2 together with sign-in."
      />
    </>
  );
}
