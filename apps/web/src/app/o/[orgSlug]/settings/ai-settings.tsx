"use client";

import { useActionState } from "react";
import { type ActionState, FormMessage, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { aiBudgetAction, aiConsentAction } from "./ai-actions";

export function AiConsentForm({ orgSlug, granted }: { orgSlug: string; granted: boolean }) {
  const [state, action] = useActionState<ActionState, FormData>(
    aiConsentAction.bind(null, orgSlug),
    null,
  );
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="grant" value={granted ? "false" : "true"} />
      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        <li>
          Knowledge documents you index and questions asked in the AI playground are sent to
          Google&apos;s Gemini API.
        </li>
        <li>
          When AI draft replies are enabled, each incoming customer WhatsApp text, and up to 10
          earlier messages from the same conversation, are sent to Gemini to write a suggested reply
          for your team to review. Drafts are never sent to WhatsApp; automatic replies stay off
          until separately approved.
        </li>
        <li>
          Use a <strong>paid</strong> Gemini API tier: Google states free-tier data may be used to
          improve its products; paid-tier data is not.
        </li>
        <li>
          Turning this off stops all future AI calls immediately. Data already sent cannot be
          recalled.
        </li>
      </ul>
      {!granted ? (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="acknowledge" className="mt-1" required />
          <span>
            I am the owner and agree to send this organization&apos;s business data to Google Gemini
            as described.
          </span>
        </label>
      ) : null}
      <FormMessage state={state} />
      <SubmitButton variant={granted ? "outline" : "default"}>
        {granted ? "Turn off AI data processing" : "Enable AI data processing"}
      </SubmitButton>
    </form>
  );
}

export function AiBudgetForm({
  orgSlug,
  orgBudget,
  platformBudget,
}: {
  orgSlug: string;
  orgBudget: number | null;
  platformBudget: number;
}) {
  const [state, action] = useActionState<ActionState, FormData>(
    aiBudgetAction.bind(null, orgSlug),
    null,
  );
  return (
    <form action={action} className="space-y-2">
      <Label htmlFor="budget">Monthly AI budget (USD)</Label>
      <div className="flex max-w-xs gap-2">
        <Input
          id="budget"
          name="budget"
          type="number"
          min={0}
          max={platformBudget}
          step="0.01"
          defaultValue={orgBudget ?? ""}
          placeholder={`Platform default: ${platformBudget.toFixed(2)}`}
        />
        <SubmitButton variant="outline">Save</SubmitButton>
      </div>
      <p className="text-xs text-muted-foreground">
        Leave empty to use the platform default (${platformBudget.toFixed(2)}). AI calls stop when
        the budget is reached.
      </p>
      <FormMessage state={state} />
    </form>
  );
}
