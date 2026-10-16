import { Users } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = { title: "Contacts" };

export default function ContactsPage() {
  return (
    <>
      <PageHeader title="Contacts" description="People who have messaged your WhatsApp number." />
      <EmptyState
        icon={Users}
        title="No contacts to show"
        description="Contacts are created automatically from real inbound messages. Nothing is imported or invented. The contact list becomes visible once sign-in is enabled."
      />
    </>
  );
}
