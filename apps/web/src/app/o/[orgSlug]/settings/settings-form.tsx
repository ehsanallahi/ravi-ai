"use client";

import { useActionState } from "react";
import { type ActionState, FormMessage, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateSettingsAction } from "./actions";

export function SettingsForm({
  orgSlug,
  name,
  timezone,
  slug,
}: {
  orgSlug: string;
  name: string;
  timezone: string;
  slug: string;
}) {
  const [state, action] = useActionState<ActionState, FormData>(
    updateSettingsAction.bind(null, orgSlug),
    null,
  );
  return (
    <form action={action} className="max-w-lg space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="name">Organization name</Label>
        <Input id="name" name="name" required minLength={2} maxLength={120} defaultValue={name} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="timezone">Time zone</Label>
        <Input
          id="timezone"
          name="timezone"
          required
          defaultValue={timezone}
          placeholder="e.g. Asia/Karachi"
        />
        <p className="text-xs text-muted-foreground">
          An IANA time zone name, such as Europe/London or America/New_York.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="slug">URL</Label>
        <Input id="slug" value={`/o/${slug}`} readOnly disabled />
        <p className="text-xs text-muted-foreground">The organization URL cannot be changed.</p>
      </div>
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Saving…">Save settings</SubmitButton>
    </form>
  );
}
