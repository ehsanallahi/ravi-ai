"use client";

import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import type * as React from "react";
import { useFormStatus } from "react-dom";
import { Alert, AlertDescription } from "./alert";
import { Button } from "./button";

export type ActionState = { ok: true; message?: string } | { ok: false; error: string } | null;

export function FormMessage({ state }: { state: ActionState }) {
  if (!state) return null;
  if (state.ok) {
    return state.message ? (
      <Alert variant="success">
        <CheckCircle2 />
        <AlertDescription>{state.message}</AlertDescription>
      </Alert>
    ) : null;
  }
  return (
    <Alert variant="destructive">
      <AlertCircle />
      <AlertDescription>{state.error}</AlertDescription>
    </Alert>
  );
}

export function SubmitButton({
  children,
  pendingLabel,
  ...props
}: React.ComponentProps<typeof Button> & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || props.disabled} {...props}>
      {pending ? <Loader2 className="animate-spin" /> : null}
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}
