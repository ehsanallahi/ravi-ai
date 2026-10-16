"use client";

import { useActionState } from "react";
import { type ActionState, FormMessage, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createLeadAction, setOptOutAction } from "../actions";

export function OptOutForm({
  orgSlug,
  contactId,
  optedOut,
}: {
  orgSlug: string;
  contactId: string;
  optedOut: boolean;
}) {
  const [state, action] = useActionState<ActionState, FormData>(
    setOptOutAction.bind(null, orgSlug, contactId),
    null,
  );
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="optedOut" value={optedOut ? "false" : "true"} />
      <p className="text-sm text-muted-foreground">
        {optedOut
          ? "This contact has opted out. No automated messages will be sent to them."
          : "Opting out blocks all automated messages to this contact."}
      </p>
      <SubmitButton variant="outline" size="sm">
        {optedOut ? "Remove opt-out" : "Mark as opted out"}
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function CreateLeadForm({ orgSlug, contactId }: { orgSlug: string; contactId: string }) {
  const [state, action] = useActionState<ActionState, FormData>(
    createLeadAction.bind(null, orgSlug, contactId),
    null,
  );
  return (
    <form action={action} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          name="title"
          required
          maxLength={200}
          placeholder="What does the customer want?"
        />
      </div>
      <div className="grid grid-cols-[1fr_6rem] gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="estimatedValue">Estimated value</Label>
          <Input
            id="estimatedValue"
            name="estimatedValue"
            inputMode="decimal"
            placeholder="Optional"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="currency">Currency</Label>
          <Input id="currency" name="currency" maxLength={3} placeholder="USD" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" name="notes" maxLength={5000} />
      </div>
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Creating…">Create lead</SubmitButton>
    </form>
  );
}
