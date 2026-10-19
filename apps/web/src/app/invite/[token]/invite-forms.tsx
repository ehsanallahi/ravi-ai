"use client";

import { useActionState } from "react";
import { type ActionState, FormMessage, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { acceptAsCurrentUserAction, acceptAsNewUserAction } from "./actions";

export function NewAccountForm({ token, email }: { token: string; email: string }) {
  const [state, action] = useActionState<ActionState, FormData>(
    acceptAsNewUserAction.bind(null, token),
    null,
  );
  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" value={email} readOnly disabled />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="name">Your name</Label>
        <Input id="name" name="name" required maxLength={120} autoComplete="name" autoFocus />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={12}
          maxLength={128}
          autoComplete="new-password"
        />
        <p className="text-xs text-muted-foreground">At least 12 characters.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirm">Confirm password</Label>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          required
          minLength={12}
          maxLength={128}
          autoComplete="new-password"
        />
      </div>
      <FormMessage state={state} />
      <SubmitButton className="w-full" pendingLabel="Creating account…">
        Create account and join
      </SubmitButton>
    </form>
  );
}

export function AcceptForm({ token }: { token: string }) {
  const [state, action] = useActionState<ActionState>(
    acceptAsCurrentUserAction.bind(null, token),
    null,
  );
  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} />
      <SubmitButton className="w-full" pendingLabel="Joining…">
        Accept invitation
      </SubmitButton>
    </form>
  );
}
