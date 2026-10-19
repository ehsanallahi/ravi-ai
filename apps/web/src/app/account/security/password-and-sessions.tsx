"use client";

import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

type Msg = { ok: boolean; text: string } | null;

function Message({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    <Alert variant={msg.ok ? "success" : "destructive"}>
      {msg.ok ? <CheckCircle2 /> : <AlertCircle />}
      <AlertDescription>{msg.text}</AlertDescription>
    </Alert>
  );
}

export function ChangePasswordForm() {
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(form: FormData) {
    const newPassword = String(form.get("newPassword") ?? "");
    if (newPassword !== String(form.get("confirm") ?? ""))
      return setMsg({ ok: false, text: "Passwords do not match." });
    setPending(true);
    const { error } = await authClient.changePassword({
      currentPassword: String(form.get("currentPassword") ?? ""),
      newPassword,
      revokeOtherSessions: true,
    });
    setPending(false);
    setMsg(
      error
        ? {
            ok: false,
            text:
              error.status === 429
                ? "Too many attempts. Please wait."
                : (error.message ?? "Could not change password."),
          }
        : { ok: true, text: "Password changed. Your other sessions were signed out." },
    );
  }

  return (
    <form action={onSubmit} className="max-w-sm space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="currentPassword">Current password</Label>
        <Input
          id="currentPassword"
          name="currentPassword"
          type="password"
          required
          autoComplete="current-password"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="newPassword">New password</Label>
        <Input
          id="newPassword"
          name="newPassword"
          type="password"
          required
          minLength={12}
          maxLength={128}
          autoComplete="new-password"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirm">Confirm new password</Label>
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
      <Message msg={msg} />
      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : null} Change password
      </Button>
    </form>
  );
}

export function SignOutOthers({ otherSessions }: { otherSessions: number }) {
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, setPending] = useState(false);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {otherSessions === 0
          ? "This is your only active session."
          : `You're signed in on ${otherSessions} other ${otherSessions === 1 ? "device or browser" : "devices or browsers"}.`}
      </p>
      <Message msg={msg} />
      <Button
        variant="outline"
        disabled={pending || otherSessions === 0}
        onClick={async () => {
          setPending(true);
          const { error } = await authClient.revokeOtherSessions();
          setPending(false);
          setMsg(
            error
              ? { ok: false, text: "Could not sign out other sessions." }
              : { ok: true, text: "Other sessions signed out." },
          );
        }}
      >
        Sign out other sessions
      </Button>
    </div>
  );
}
