import { can, canAssignRole, ROLES } from "@ravi/core";
import { ShieldCheck, ShieldOff } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, roleLabel } from "@/lib/format";
import { listPendingInvitations } from "@/server/services/invitations";
import { listMembers } from "@/server/services/members";
import { requireTenant } from "@/server/tenancy/next";
import { InviteForm, RemoveMemberForm, RevokeInvitationForm, RoleForm } from "./team-forms";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireTenant(orgSlug);
  const canManage = can(ctx.role, "members:manage");
  const [members, invitations] = await Promise.all([
    listMembers(ctx),
    canManage ? listPendingInvitations(ctx) : Promise.resolve([]),
  ]);
  const assignableRoles = ROLES.filter((r) => canAssignRole(ctx.role, r));

  return (
    <>
      <PageHeader
        title="Team"
        description="People who can access this organization and what they can do."
      />

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>Invite a teammate</CardTitle>
            <CardDescription>
              Invitations expire after 7 days and only work for the invited email address. Owners
              and admins must set up two-factor authentication before they can access the
              organization.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <InviteForm orgSlug={orgSlug} assignableRoles={assignableRoles} />
          </CardContent>
        </Card>
      ) : null}

      <Card className="pb-0">
        <CardHeader>
          <CardTitle>Members ({members.length})</CardTitle>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="hidden md:table-cell">2FA</TableHead>
              <TableHead className="hidden sm:table-cell">Joined</TableHead>
              <TableHead className="text-right">Role</TableHead>
              <TableHead className="w-24 text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => {
              const isSelf = m.user.id === ctx.userId;
              const canEditThis =
                canManage && !isSelf && (m.role !== "OWNER" || ctx.role === "OWNER");
              return (
                <TableRow key={m.id}>
                  <TableCell>
                    <p className="font-medium">
                      {m.user.name ?? m.user.email}{" "}
                      {isSelf ? <span className="text-muted-foreground">(you)</span> : null}
                    </p>
                    <p className="text-xs text-muted-foreground">{m.user.email}</p>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {m.user.twoFactorEnabled ? (
                      <ShieldCheck className="size-4 text-primary" aria-label="Enabled" />
                    ) : (
                      <ShieldOff
                        className="size-4 text-muted-foreground"
                        aria-label="Not enabled"
                      />
                    )}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">
                    {formatDate(m.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    {canEditThis ? (
                      <RoleForm
                        orgSlug={orgSlug}
                        membershipId={m.id}
                        role={m.role}
                        assignableRoles={assignableRoles}
                      />
                    ) : (
                      <Badge variant="secondary">{roleLabel(m.role)}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {canEditThis || isSelf ? (
                      <RemoveMemberForm orgSlug={orgSlug} membershipId={m.id} isSelf={isSelf} />
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      {canManage ? (
        <Card className="pb-0">
          <CardHeader>
            <CardTitle>Pending invitations</CardTitle>
          </CardHeader>
          {invitations.length === 0 ? (
            <CardContent className="pb-5">
              <p className="text-sm text-muted-foreground">No pending invitations.</p>
            </CardContent>
          ) : (
            <Table>
              <TableBody>
                {invitations.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell>
                      <p className="font-medium">{i.email}</p>
                      <p className="text-xs text-muted-foreground">
                        {roleLabel(i.role)} · invited by {i.invitedBy.name ?? "a teammate"} ·
                        expires {formatDate(i.expiresAt)}
                      </p>
                    </TableCell>
                    <TableCell className="text-right">
                      <RevokeInvitationForm orgSlug={orgSlug} invitationId={i.id} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      ) : null}
    </>
  );
}
