"use client";

import { Building2, Check, ChevronsUpDown } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { roleLabel } from "@/lib/format";

export interface OrgOption {
  slug: string;
  name: string;
  role: string;
}

export function OrgSwitcher({
  current,
  organizations,
}: {
  current: OrgOption;
  organizations: OrgOption[];
}) {
  useEffect(() => {
    // Remembers the last organization for /dashboard. It's a preference only (a slug), not auth.
    try {
      document.cookie = `ravi_last_org=${encodeURIComponent(current.slug)}; path=/; max-age=31536000; samesite=lax`;
    } catch {
      /* ignore */
    }
  }, [current.slug]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="h-9 max-w-[16rem] justify-between gap-2">
          <Building2 className="text-muted-foreground" />
          <span className="truncate">{current.name}</span>
          <ChevronsUpDown className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Your organizations</DropdownMenuLabel>
        {organizations.map((org) => (
          <DropdownMenuItem key={org.slug} asChild>
            <Link href={`/o/${org.slug}`} className="flex items-center justify-between">
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{org.name}</span>
                <span className="text-xs text-muted-foreground">{roleLabel(org.role)}</span>
              </span>
              {org.slug === current.slug ? <Check /> : null}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
