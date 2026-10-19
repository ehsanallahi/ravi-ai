"use client";

import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

type Setup = { qr: string; secret: string; backupCodes: string[] };

export function TwoFactorSetup({ enabled, next }: { enabled: boolean; next: string | null }) {
  const router = useRouter();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  async function start(form: FormData) {
    setPending(true);
    setError(null);
    const { data, error } = await authClient.twoFactor.enable({
      password: String(form.get("password") ?? ""),
    });
    setPending(false);
    if (error || !data || !("totpURI" in data) || !data.totpURI) {
      return setError(
        error?.status === 429 ? "Too many attempts. Please wait a minute." : "Incorrect password.",
      );
    }
    const uri = data.totpURI;
    setSetup({
      qr: await QRCode.toDataURL(uri, { margin: 1, width: 200 }),
      secret: new URL(uri).searchParams.get("secret") ?? "",
      backupCodes: data.backupCodes ?? [],
    });
  }

  async function verify(form: FormData) {
    setPending(true);
    setError(null);
    const { error } = await authClient.twoFactor.verifyTotp({
      code: String(form.get("code") ?? "").replace(/\s+/g, ""),
    });
    setPending(false);
    if (error)
      return setError("That code is not valid. Check the time on your device and try again.");
    setDone(true);
    router.refresh();
  }

  async function disable(form: FormData) {
    setPending(true);
    setError(null);
    const { error } = await authClient.twoFactor.disable({
      password: String(form.get("password") ?? ""),
    });
    setPending(false);
    if (error) return setError("Incorrect password.");
    router.refresh();
  }

  if (done) {
    return (
      <div className="space-y-3">
        <Alert variant="success">
          <CheckCircle2 />
          <AlertDescription>
            Two-factor authentication is on. You'll be asked for a code each time you sign in.
          </AlertDescription>
        </Alert>
        {next ? <Button onClick={() => router.push(next)}>Continue</Button> : null}
      </div>
    );
  }

  if (enabled) {
    return (
      <form action={disable} className="space-y-3">
        <Alert variant="success">
          <CheckCircle2 />
          <AlertDescription>Two-factor authentication is on.</AlertDescription>
        </Alert>
        <p className="text-sm text-muted-foreground">
          Owners and admins can't access their organizations without it. Turning it off also locks
          you out of those organizations until you set it up again.
        </p>
        <div className="flex max-w-sm gap-2">
          <Input
            name="password"
            type="password"
            required
            placeholder="Current password"
            autoComplete="current-password"
            aria-label="Current password"
          />
          <Button type="submit" variant="outline" disabled={pending}>
            Turn off
          </Button>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </form>
    );
  }

  if (!setup) {
    return (
      <form action={start} className="max-w-sm space-y-3">
        <p className="text-sm text-muted-foreground">
          Use an authenticator app such as Google Authenticator, 1Password or Authy. Confirm your
          password to begin.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="tf-password">Current password</Label>
          <Input
            id="tf-password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
          />
        </div>
        {error ? (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null} Set up two-factor authentication
        </Button>
      </form>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-[200px_1fr]">
      {/* eslint-disable-next-line @next/next/no-img-element -- local data URL, not a remote image */}
      <img
        src={setup.qr}
        alt="QR code for your authenticator app"
        width={200}
        height={200}
        className="rounded-lg border bg-white"
      />
      <div className="space-y-4">
        <div className="space-y-1">
          <p className="text-sm font-medium">1. Scan the QR code</p>
          <p className="text-sm text-muted-foreground">
            Or enter this key manually:{" "}
            <code className="rounded bg-muted px-1 break-all">{setup.secret}</code>
          </p>
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">2. Save your backup codes</p>
          <p className="text-sm text-muted-foreground">
            Each code works once if you lose your device. Store them somewhere safe; they won't be
            shown again.
          </p>
          <ul className="grid grid-cols-2 gap-1 rounded-lg border bg-muted/40 p-3 font-mono text-sm">
            {setup.backupCodes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
        <form action={verify} className="space-y-2">
          <Label htmlFor="tf-code">3. Enter the 6-digit code from the app</Label>
          <div className="flex max-w-xs gap-2">
            <Input
              id="tf-code"
              name="code"
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="123456"
            />
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : null} Verify
            </Button>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </form>
      </div>
    </div>
  );
}
