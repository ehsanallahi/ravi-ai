import type * as React from "react";
import { Brand } from "@/components/layout/brand";
import { MobileNav } from "@/components/layout/mobile-nav";
import { OrgSwitcher } from "@/components/layout/org-switcher";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { UserMenu } from "@/components/layout/user-menu";
import { Badge } from "@/components/ui/badge";
import { roleLabel } from "@/lib/format";
import { listMyOrganizations, requireSession } from "@/server/auth/session";
import { requireTenant } from "@/server/tenancy/next";

export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const ctx = await requireTenant(orgSlug);
  const session = await requireSession();
  const organizations = await listMyOrganizations(ctx.userId);
  const current = { slug: ctx.organizationSlug, name: ctx.organizationName, role: ctx.role };

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r bg-sidebar lg:flex">
        <div className="flex h-16 items-center">
          <Brand href={`/o/${orgSlug}`} />
        </div>
        <SidebarNav orgSlug={orgSlug} />
        <div className="mt-auto space-y-1 px-6 py-4 text-xs text-muted-foreground">
          <p>AI replies: off</p>
          <p>Live WhatsApp sending: off</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur sm:gap-3 sm:px-6">
          <MobileNav orgSlug={orgSlug} />
          <OrgSwitcher current={current} organizations={organizations} />
          <Badge variant="secondary" className="hidden sm:inline-flex">
            {roleLabel(ctx.role)}
          </Badge>
          <div className="ml-auto">
            <UserMenu name={session.user.name ?? session.user.email} email={session.user.email} />
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
