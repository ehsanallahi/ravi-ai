import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/layout/auth-shell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { roleLabel } from "@/lib/format";
import { getCurrentSession } from "@/server/auth/session";
import { lookupInvitation } from "@/server/services/invitations";
import { AcceptForm, NewAccountForm } from "./invite-forms";

export const metadata: Metadata = { title: "Invitation", robots: { index: false } };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [lookup, session] = await Promise.all([lookupInvitation(token), getCurrentSession()]);

  if (lookup.status !== "valid") {
    const text =
      lookup.status === "used"
        ? "This invitation has already been used."
        : lookup.status === "expired"
          ? "This invitation has expired. Ask the person who invited you for a new one."
          : "This invitation link is not valid.";
    return (
      <AuthShell title="Invitation unavailable">
        <Alert variant="destructive">
          <AlertDescription>{text}</AlertDescription>
        </Alert>
      </AuthShell>
    );
  }

  const { invitation, accountExists } = lookup;
  const description = `You've been invited to join ${invitation.organizationName} as ${roleLabel(invitation.role)}.`;
  const next = encodeURIComponent(`/invite/${token}`);

  if (session) {
    if (session.user.email.toLowerCase() !== invitation.email) {
      return (
        <AuthShell title="Wrong account" description={description}>
          <p className="text-sm text-muted-foreground">
            This invitation is for <strong>{invitation.email}</strong>, but you're signed in as{" "}
            {session.user.email}. Sign out and sign in with the invited address.
          </p>
        </AuthShell>
      );
    }
    return (
      <AuthShell title={`Join ${invitation.organizationName}`} description={description}>
        <AcceptForm token={token} />
      </AuthShell>
    );
  }

  if (accountExists) {
    return (
      <AuthShell title={`Join ${invitation.organizationName}`} description={description}>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            An account already exists for {invitation.email}. Sign in to accept the invitation.
          </p>
          <Button asChild className="w-full">
            <Link href={`/login?next=${next}`}>Sign in to accept</Link>
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={`Join ${invitation.organizationName}`}
      description={description}
      footer={
        invitation.role === "OWNER" || invitation.role === "ADMIN"
          ? "Your role requires two-factor authentication. You'll set it up after signing in."
          : undefined
      }
    >
      <NewAccountForm token={token} email={invitation.email} />
    </AuthShell>
  );
}
