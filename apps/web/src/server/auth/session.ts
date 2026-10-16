import "server-only";
import { prisma } from "@ravi/db";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { listUserOrganizations } from "../tenancy/context";
import { getAuth } from "./auth";

/** Authoritative session check against the database (no cookie cache). Memoised per request. */
export const getCurrentSession = cache(async () => {
  // Read request headers first: this marks the route dynamic, so authenticated pages are never
  // prerendered at build time (and auth secrets are not needed during `next build`).
  const requestHeaders = await headers();
  return getAuth().api.getSession({ headers: requestHeaders });
});

export type CurrentSession = NonNullable<Awaited<ReturnType<typeof getCurrentSession>>>;

export async function requireSession(next?: string): Promise<CurrentSession> {
  const session = await getCurrentSession();
  if (!session) redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  return session;
}

/** Organizations of the signed-in user, for the switcher and /dashboard. */
export async function listMyOrganizations(userId: string) {
  return listUserOrganizations(prisma, userId);
}

/** Other active sessions of the signed-in user (for "sign out other sessions"). */
export async function countOtherSessions(
  userId: string,
  currentSessionId: string,
): Promise<number> {
  return prisma.session.count({
    where: { userId, id: { not: currentSessionId }, expiresAt: { gt: new Date() } },
  });
}

/** Only allows same-site relative paths as post-login destinations (prevents open redirects). */
export function safeNextPath(next: string | null | undefined, fallback = "/dashboard"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return fallback;
  }
  return next;
}
