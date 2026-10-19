"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

type Step = "credentials" | "totp" | "backup";

function describeError(error: { status?: number; message?: string } | null | undefined): string {
  if (!error) return "Something went wrong. Please try again.";
  if (error.status === 429) return "Too many attempts. Wait a minute and try again.";
  if (error.status === 403) {
    return "Please verify your email address first. We've sent you a new verification link.";
  }
  if (error.status === 401) return "Incorrect email or password.";
  return error.message ?? "Sign-in failed.";
}

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("credentials");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const finish = () => {
    router.replace(next);
    router.refresh();
  };

  async function onCredentials(form: FormData) {
    setPending(true);
    setError(null);
    const { data, error } = await authClient.signIn.email({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      callbackURL: "/login?verified=1",
    });
    setPending(false);
    if (error) return setError(describeError(error));
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) return setStep("totp");
    finish();
  }

  async function onCode(form: FormData) {
    setPending(true);
    setError(null);
    const code = String(form.get("code") ?? "").replace(/\s+/g, "");
    const { error } =
      step === "totp"
        ? await authClient.twoFactor.verifyTotp({ code, trustDevice: false })
        : await authClient.twoFactor.verifyBackupCode({ code, trustDevice: false });
    setPending(false);
    if (error) {
      return setError(
        error.status === 429 ? describeError(error) : "That code is not valid. Try again.",
      );
    }
    finish();
  }

  if (step !== "credentials") {
    return (
      <form action={onCode} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="code">{step === "totp" ? "Authenticator code" : "Backup code"}</Label>
          <Input
            id="code"
            name="code"
            required
            autoFocus
            autoComplete="one-time-code"
            inputMode={step === "totp" ? "numeric" : "text"}
            maxLength={step === "totp" ? 6 : 32}
            placeholder={step === "totp" ? "123456" : "xxxxx-xxxxx"}
          />
        </div>
        {error ? (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null} Verify
        </Button>
        <Button
          type="button"
          variant="link"
          className="w-full"
          onClick={() => {
            setError(null);
            setStep(step === "totp" ? "backup" : "totp");
          }}
        >
          {step === "totp" ? "Use a backup code instead" : "Use your authenticator app"}
        </Button>
      </form>
    );
  }

  return (
    <form action={onCredentials} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required autoComplete="email" autoFocus />
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Password</Label>
          <Link href="/forgot-password" className="text-xs text-primary hover:underline">
            Forgot password?
          </Link>
        </div>
        <Input
          id="password"
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
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : null} Sign in
      </Button>
    </form>
  );
}
