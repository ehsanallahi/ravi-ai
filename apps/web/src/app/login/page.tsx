import { CheckCircle2, Info } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/layout/auth-shell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { getCurrentSession, safeNextPath } from "@/server/auth/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    next?: string;
    verified?: string;
    reset?: string;
    invited?: string;
    unverified?: string;
  }>;
}) {
  const sp = await searchParams;
  const next = safeNextPath(sp.next);
  if (await getCurrentSession()) redirect(next);

  const notice = sp.verified
    ? "Email verified. You can sign in now."
    : sp.reset
      ? "Password changed. Sign in with your new password."
      : sp.invited
        ? "Account created. Sign in to continue."
        : null;

  return (
    <AuthShell
      title="Sign in"
      description="Access your Ravi AI workspace."
      footer="Registration is by invitation only."
    >
      <div className="space-y-4">
        {notice ? (
          <Alert variant="success">
            <CheckCircle2 />
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        ) : null}
        {sp.unverified ? (
          <Alert>
            <Info />
            <AlertDescription>Verify your email address to continue.</AlertDescription>
          </Alert>
        ) : null}
        <LoginForm next={next} />
      </div>
    </AuthShell>
  );
}
