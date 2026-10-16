"use client";

import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

export function ForgotPasswordForm() {
  const [state, setState] = useState<"idle" | "pending" | "sent" | "limited">("idle");

  async function onSubmit(form: FormData) {
    setState("pending");
    const { error } = await authClient.requestPasswordReset({
      email: String(form.get("email") ?? ""),
      redirectTo: "/reset-password",
    });
    // Same message whether or not the account exists (no enumeration).
    setState(error?.status === 429 ? "limited" : "sent");
  }

  if (state === "sent") {
    return (
      <Alert variant="success">
        <CheckCircle2 />
        <AlertDescription>
          If an account exists for that email, a reset link is on its way.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <form action={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required autoComplete="email" autoFocus />
      </div>
      {state === "limited" ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>Too many requests. Please wait a few minutes.</AlertDescription>
        </Alert>
      ) : null}
      <Button type="submit" className="w-full" disabled={state === "pending"}>
        {state === "pending" ? <Loader2 className="animate-spin" /> : null} Send reset link
      </Button>
    </form>
  );
}
