"use client";

import { useActionState } from "react";
import { type ActionState, FormMessage, SubmitButton } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { askAction, reviewAction } from "./actions";

export function AskForm({ orgSlug, disabled }: { orgSlug: string; disabled: boolean }) {
  const [state, action] = useActionState<ActionState, FormData>(
    askAction.bind(null, orgSlug),
    null,
  );
  return (
    <form action={action} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="question">Customer question</Label>
        <Textarea
          id="question"
          name="question"
          rows={3}
          required
          maxLength={2000}
          disabled={disabled}
          dir="auto"
          placeholder={
            "Ask like a customer would, e.g.\n“What is the price of the cotton kurta?” · “کیا لاہور میں ڈیلیوری ہوتی ہے؟” · “delivery kitne din mein hogi?”"
          }
        />
      </div>
      <FormMessage state={state} />
      <SubmitButton disabled={disabled} pendingLabel="Thinking…">
        Ask the assistant
      </SubmitButton>
    </form>
  );
}

export function ReviewForm({
  orgSlug,
  suggestionId,
  current,
}: {
  orgSlug: string;
  suggestionId: string;
  current: { rating: number | null; notes: string | null };
}) {
  const [state, action] = useActionState<ActionState, FormData>(
    reviewAction.bind(null, orgSlug, suggestionId),
    null,
  );
  return (
    <form action={action} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="rating">Answer quality</Label>
        <Select name="rating" defaultValue={current.rating ? String(current.rating) : undefined}>
          <SelectTrigger id="rating">
            <SelectValue placeholder="Rate 1–5 (optional)" />
          </SelectTrigger>
          <SelectContent>
            {[5, 4, 3, 2, 1].map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n} — {["", "Wrong", "Poor", "Acceptable", "Good", "Excellent"][n]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          name="notes"
          rows={3}
          maxLength={2000}
          defaultValue={current.notes ?? ""}
          placeholder="What was right or wrong?"
        />
      </div>
      <FormMessage state={state} />
      <div className="flex flex-wrap gap-2">
        <SubmitButton name="status" value="APPROVED">
          Approve
        </SubmitButton>
        <SubmitButton name="status" value="REJECTED" variant="outline">
          Reject
        </SubmitButton>
      </div>
      <p className="text-xs text-muted-foreground">
        Reviews are evaluation records only. Approving never sends a message.
      </p>
    </form>
  );
}
