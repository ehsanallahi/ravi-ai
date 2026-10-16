import { ArrowLeft, ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { countOtherSessions, requireSession, safeNextPath } from "@/server/auth/session";
import { ChangePasswordForm, SignOutOthers } from "./password-and-sessions";
import { TwoFactorSetup } from "./two-factor-setup";

export const metadata: Metadata = { title: "Security" };

export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ required?: string; next?: string }>;
}) {
  const sp = await searchParams;
  const session = await requireSession("/account/security");
  const next = sp.next ? safeNextPath(sp.next) : null;
  const otherSessions = await countOtherSessions(session.user.id, session.session.id);
  const twoFactorEnabled = Boolean(session.user.twoFactorEnabled);

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6 lg:p-8">
      <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
        <Link href={next ?? "/dashboard"}>
          <ArrowLeft /> Back
        </Link>
      </Button>
      <PageHeader title="Account security" description={`Signed in as ${session.user.email}`} />

      {sp.required && !twoFactorEnabled ? (
        <Alert variant="destructive">
          <ShieldAlert />
          <AlertTitle>Two-factor authentication required</AlertTitle>
          <AlertDescription>
            Owners and admins must use an authenticator app. Set it up below to access your
            organization.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Two-factor authentication</CardTitle>
          <CardDescription>
            A time-based code from your phone, in addition to your password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TwoFactorSetup enabled={twoFactorEnabled} next={next} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sessions</CardTitle>
        </CardHeader>
        <CardContent>
          <SignOutOthers otherSessions={otherSessions} />
        </CardContent>
      </Card>
    </main>
  );
}
