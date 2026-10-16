import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/layout/auth-shell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;
  const valid = typeof token === "string" && token.length > 0 && !error;
  return (
    <AuthShell
      title="Choose a new password"
      description="Use at least 12 characters. All your other sessions will be signed out."
      footer={
        <Link href="/login" className="text-primary hover:underline">
          Back to sign in
        </Link>
      }
    >
      {valid ? (
        <ResetPasswordForm token={token} />
      ) : (
        <Alert variant="destructive">
          <AlertDescription>
            This reset link is invalid or has expired.{" "}
            <Link href="/forgot-password" className="underline">
              Request a new one
            </Link>
            .
          </AlertDescription>
        </Alert>
      )}
    </AuthShell>
  );
}
