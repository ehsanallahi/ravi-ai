"use client";

import { useActionState } from "react";
import { type ActionState, FormMessage, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { roleLabel } from "@/lib/format";
import {
  changeRoleAction,
  inviteMemberAction,
  removeMemberAction,
  revokeInvitationAction,
} from "./actions";

export function InviteForm({
  orgSlug,
  assignableRoles,
}: {
  orgSlug: string;
  assignableRoles: string[];
}) {
  const [state, action] = useActionState<ActionState, FormData>(
    inviteMemberAction.bind(null, orgSlug),
    null,
  );
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="invite-email">Email</Label>
          <Input
            id="invite-email"
            name="email"
            type="email"
            required
            autoComplete="off"
            placeholder="teammate@company.com"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="invite-role">Role</Label>
          <Select name="role" defaultValue="AGENT">
            <SelectTrigger id="invite-role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {assignableRoles.map((r) => (
                <SelectItem key={r} value={r}>
                  {roleLabel(r)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <SubmitButton pendingLabel="Inviting…">Send invitation</SubmitButton>
      </div>
      <div className="break-all">
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function RoleForm({
  orgSlug,
  membershipId,
  role,
  assignableRoles,
}: {
  orgSlug: string;
  membershipId: string;
  role: string;
  assignableRoles: string[];
}) {
  const [state, action] = useActionState<ActionState, FormData>(
    changeRoleAction.bind(null, orgSlug, membershipId),
    null,
  );
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <Select name="role" defaultValue={role}>
          <SelectTrigger className="h-8 w-32" aria-label="Role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Array.from(new Set([role, ...assignableRoles])).map((r) => (
              <SelectItem key={r} value={r}>
                {roleLabel(r)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <SubmitButton size="sm" variant="outline">
          Save
        </SubmitButton>
      </div>
      {state && !state.ok ? <p className="text-xs text-destructive">{state.error}</p> : null}
    </form>
  );
}

export function RemoveMemberForm({
  orgSlug,
  membershipId,
  isSelf,
}: {
  orgSlug: string;
  membershipId: string;
  isSelf: boolean;
}) {
  const [state, action] = useActionState<ActionState>(
    removeMemberAction.bind(null, orgSlug, membershipId, isSelf),
    null,
  );
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (
          !confirm(
            isSelf ? "Leave this organization?" : "Remove this member from the organization?",
          )
        )
          e.preventDefault();
      }}
      className="flex flex-col items-end gap-1"
    >
      <SubmitButton size="sm" variant="ghost" className="text-destructive">
        {isSelf ? "Leave" : "Remove"}
      </SubmitButton>
      {state && !state.ok ? <p className="text-xs text-destructive">{state.error}</p> : null}
    </form>
  );
}

export function RevokeInvitationForm({
  orgSlug,
  invitationId,
}: {
  orgSlug: string;
  invitationId: string;
}) {
  const [state, action] = useActionState<ActionState>(
    revokeInvitationAction.bind(null, orgSlug, invitationId),
    null,
  );
  return (
    <form action={action}>
      <SubmitButton size="sm" variant="ghost">
        Revoke
      </SubmitButton>
      {state && !state.ok ? <p className="text-xs text-destructive">{state.error}</p> : null}
    </form>
  );
}

export { FormMessage };
