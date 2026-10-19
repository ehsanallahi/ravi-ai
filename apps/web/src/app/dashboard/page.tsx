import { Building2 } from "lucide-react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/layout/empty-state";
import { listMyOrganizations, requireSession } from "@/server/auth/session";

export const metadata: Metadata = { title: "Dashboard" };

/** Sends the user to their last-used organization (or their first one). */
export default async function DashboardRedirect() {
  const session = await requireSession("/dashboard");
  const organizations = await listMyOrganizations(session.user.id);
  if (organizations.length === 0) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-lg items-center p-6">
        <EmptyState
          icon={Building2}
          title="You're not a member of any organization"
          description="Ask an owner or admin to invite you. Registration is closed, so organizations are created by the platform operator."
        />
      </main>
    );
  }
  const last = (await cookies()).get("ravi_last_org")?.value;
  const target = organizations.find((o) => o.slug === last) ?? organizations[0]!;
  redirect(`/o/${target.slug}`);
}
