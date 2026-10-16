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
import { Textarea } from "@/components/ui/textarea";
import { statusLabel } from "@/lib/format";
import { updateLeadAction } from "../actions";

const STATUSES = ["NEW", "CONTACTED", "QUALIFIED", "WON", "LOST"] as const;

export function LeadForm({
  orgSlug,
  lead,
  readOnly,
}: {
  orgSlug: string;
  lead: {
    id: string;
    title: string | null;
    status: string;
    notes: string | null;
    estimatedValue: string | null;
    currency: string | null;
  };
  readOnly: boolean;
}) {
  const [state, action] = useActionState<ActionState, FormData>(
    updateLeadAction.bind(null, orgSlug, lead.id),
    null,
  );
  return (
    <form action={action} className="space-y-4">
      <fieldset disabled={readOnly} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="title">Title</Label>
          <Input id="title" name="title" required maxLength={200} defaultValue={lead.title ?? ""} />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="status">Status</Label>
            <Select name="status" defaultValue={lead.status} disabled={readOnly}>
              <SelectTrigger id="status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {statusLabel(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="estimatedValue">Estimated value</Label>
            <Input
              id="estimatedValue"
              name="estimatedValue"
              inputMode="decimal"
              defaultValue={lead.estimatedValue ?? ""}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="currency">Currency</Label>
            <Input
              id="currency"
              name="currency"
              maxLength={3}
              defaultValue={lead.currency ?? ""}
              placeholder="USD"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="notes">Notes</Label>
          <Textarea
            id="notes"
            name="notes"
            rows={6}
            maxLength={5000}
            defaultValue={lead.notes ?? ""}
          />
        </div>
      </fieldset>
      <FormMessage state={state} />
      {readOnly ? (
        <p className="text-sm text-muted-foreground">Your role can view but not edit leads.</p>
      ) : (
        <SubmitButton pendingLabel="Saving…">Save lead</SubmitButton>
      )}
    </form>
  );
}
