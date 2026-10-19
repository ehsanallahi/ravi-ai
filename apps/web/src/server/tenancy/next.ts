import "server-only";
import type { Permission } from "@ravi/core";
import { createLogger } from "@ravi/core";
import { prisma } from "@ravi/db";
import { notFound, redirect } from "next/navigation";
import { providerErrorStatus } from "@ravi/ai-engine";
import { AiConfigError, AiGuardError, AssistantInputError, IndexingError } from "@ravi/knowledge";
import { ExtractionError } from "@ravi/knowledge/extract";
import { ZodError } from "zod";
import type { ActionState } from "@/components/ui/form";
import { UserInputError } from "../auth/users";
import { getCurrentSession } from "../auth/session";
import { resolveTenant, TenantAccessError, type TenantContext } from "./context";
import { DomainError } from "./errors";

const log = createLogger({ service: "web", component: "tenancy" });

function handleAccessError(err: TenantAccessError, orgSlug: string): never {
  const next = encodeURIComponent(`/o/${orgSlug}`);
  switch (err.reason) {
    // redirect() and notFound() throw; the explicit returns just make that visible.
    case "unauthenticated":
      return redirect(`/login?next=${next}`);
    case "email_unverified":
      return redirect("/login?unverified=1");
    case "two_factor_required":
      return redirect(`/account/security?required=1&next=${next}`);
    case "not_found":
      return notFound();
    case "forbidden":
      throw err;
  }
}

/**
 * For Server Components. Every page under /o/[orgSlug] calls this first. Re-validates the session
 * against the database and resolves the membership; never trust the proxy alone.
 */
export async function requireTenant(
  orgSlug: string,
  permission?: Permission,
): Promise<TenantContext> {
  const session = await getCurrentSession();
  try {
    return await resolveTenant(prisma, session?.user, orgSlug, permission);
  } catch (err) {
    if (err instanceof TenantAccessError) handleAccessError(err, orgSlug);
    throw err;
  }
}

function errorToState(err: unknown): ActionState {
  if (err instanceof TenantAccessError) {
    return { ok: false, error: "You don't have permission to do that." };
  }
  if (err instanceof DomainError || err instanceof UserInputError)
    return { ok: false, error: err.message };
  if (err instanceof ZodError)
    return { ok: false, error: err.issues[0]?.message ?? "Invalid input" };
  // AI and knowledge errors carry messages written for administrators (no secrets, no prompts).
  if (
    err instanceof AiGuardError ||
    err instanceof AiConfigError ||
    err instanceof IndexingError ||
    err instanceof AssistantInputError ||
    err instanceof ExtractionError
  ) {
    return { ok: false, error: err.message };
  }
  const status = providerErrorStatus(err);
  if (status !== null) {
    log.warn("AI provider error", { status });
    return {
      ok: false,
      error:
        status === 429
          ? "The AI provider is rate-limiting requests. Try again in a minute."
          : `The AI provider returned an error (HTTP ${status}). Try again later.`,
    };
  }
  log.error("action failed", { error: err instanceof Error ? err.message : String(err) });
  return { ok: false, error: "Something went wrong. Please try again." };
}

/**
 * For Server Actions: resolves the tenant (with the required permission) and converts known
 * errors into a user-safe ActionState. Unknown errors are logged, not shown.
 */
export async function tenantAction(
  orgSlug: string,
  permission: Permission | undefined,
  fn: (ctx: TenantContext) => Promise<ActionState | void>,
): Promise<ActionState> {
  const session = await getCurrentSession();
  let ctx: TenantContext;
  try {
    ctx = await resolveTenant(prisma, session?.user, orgSlug, permission);
  } catch (err) {
    if (err instanceof TenantAccessError && err.reason !== "forbidden")
      handleAccessError(err, orgSlug);
    return errorToState(err);
  }
  try {
    return (await fn(ctx)) ?? { ok: true };
  } catch (err) {
    return errorToState(err);
  }
}

export { errorToState };
