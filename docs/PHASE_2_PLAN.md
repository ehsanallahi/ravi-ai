# Ravi AI — Phase 2 Implementation Plan

**Theme:** Authenticated, tenant-isolated dashboard
**Builds on:** Phase 1 (`feat/phase-1-foundation`, commit `afcc46e`)
**Status:** Proposed. The decisions in §9 need sign-off before work starts.

## 0. Guardrails for this phase

- **AI replies stay off.** `AI_AUTO_REPLY_ENABLED=false`, and Phase 2 adds no UI that turns
  `Organization.aiAutoReplyEnabled` on.
- **Migrations are additive only.** No drops, renames or type changes. Every migration is reviewed
  before commit and applied with `migrate deploy`. `migrate dev` runs only against the local
  development database.
- **No production credentials.** Development and test use a local PostgreSQL instance only.
- **No fabricated business data.** Synthetic fixtures exist only inside the throwaway **test**
  database. A guard refuses to run them against any other database.
- **Server-side enforcement.** The proxy (`proxy.ts`, formerly `middleware.ts`) handles redirects
  only. Every data access re-checks the session and membership on the server.

## 1. PostgreSQL development database integration

| Task                    | Detail                                                                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local databases         | `ravi_ai_dev` (development) and `ravi_ai_test` (integration tests) on local Postgres or `docker compose`. Add a test database init script to `docker-compose.yml`.        |
| Env files               | `.env` holds `DATABASE_URL` for dev. `.env.test` (git-ignored) holds `DATABASE_URL` for test, and `.env.test.example` is committed.                                       |
| Apply Phase 1 migration | `pnpm db:migrate:deploy` against dev. Confirm that the worker's raw SQL (queue claim, full-text retrieval) runs against real Postgres.                                    |
| Safety guard            | `assertSafeTestDatabase(url)` throws unless the host is `localhost`/`127.0.0.1` **and** the database name ends with `_test`. It runs before any test setup or truncation. |
| CI                      | GitHub Actions workflow with a `postgres:16` service container: lint, type-check, unit tests, integration tests and build.                                                |

**Exit:** a fresh clone reaches a migrated dev database with four commands, and CI is green.

## 2. Secure admin authentication

**Recommendation: Better Auth (1.7.x) with the Prisma adapter, used for authentication only.**
Ravi AI keeps its own `Organization` and `Membership` tables and its own RBAC, so authorization
logic stays ours. Better Auth's organization plugin is not used.

| Concern                               | Implementation                                                                                                                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Credentials                           | Email and password. Password hashing is the library default (scrypt), or argon2id through `@node-rs/argon2`; decide during the spike. Minimum 12 characters.                                      |
| Sessions                              | Database sessions. Cookies are `HttpOnly`, `Secure`, and `SameSite=Lax`, with the `__Secure-` prefix in production. Idle expiry is 7 days with rotation. Sessions are revoked on password change. |
| Brute force                           | Built-in rate limiting stored in the database (not in memory, so it works across replicas). Login attempts are audit-logged.                                                                      |
| CSRF                                  | The library's origin checks, plus the built-in origin check on Next.js Server Actions. `BETTER_AUTH_URL` and `trustedOrigins` are pinned.                                                         |
| Email verification and password reset | Need an email provider, which is decision §9.3. Until one is configured, verification is skipped in dev, and **the production boot check fails** if no email provider is set.                     |
| 2FA                                   | TOTP plugin. Optional in Phase 2, with an organization setting so owners can require it.                                                                                                          |
| Secrets                               | New `BETTER_AUTH_SECRET` (`openssl rand -base64 32`), added to `.env.example` as a placeholder.                                                                                                   |
| Bootstrap                             | `pnpm --filter @ravi/web admin:create` CLI creates the first owner, their organization and an OWNER membership in one transaction, prompting for the password on stdin.                           |

**Schema (additive migration `2026xxxx_auth`):**

- New `Session`, `Account` and `Verification` models, mapped to the Better Auth schema.
- `User` gains `emailVerified Boolean @default(false)` and `image String?`.
- `User.passwordHash` stays in place, marked deprecated (Better Auth stores credentials in
  `Account`). It is not dropped.
- The spike confirms the field mapping with `@better-auth/cli generate` before the migration is
  written by hand.

## 3. Organization registration and management

- **Registration mode** comes from `REGISTRATION_MODE=closed|invite|open`, default `closed`.
  - `closed`: owners are created by the CLI only.
  - `invite`: sign-up requires a valid invitation.
  - `open`: sign-up creates a user, an organization and an OWNER membership in one transaction.
- **Organization settings:** name, URL-safe unique slug (reserved words blocked) and timezone,
  editable by Owner and Admin.
- **Invitations:** new additive `Invitation` model (`organizationId`, `email`, `role`,
  `tokenHash`, `expiresAt`, `acceptedAt`, `invitedByUserId`). Tokens are 32 random bytes and only
  their SHA-256 hash is stored. They expire after 7 days, work once, and the email must match.
  Delivery depends on the email provider; until then the invite link is shown once to the
  inviter.
- **Members:** list members, change roles (`canAssignRole`), and remove members. The last OWNER
  can never be removed or demoted. All changes are written to `AuditLog`.
- **Organization switcher** for users with several memberships. The active organization is the
  URL segment `/o/[orgSlug]/…`, never a client-supplied ID in a request body.

## 4. Role-based access control

The Phase 1 `can()`, `assertCan()` and `canAssignRole()` functions in `@ravi/core` become the
single source of truth.

```ts
// apps/web/src/server/auth/tenant.ts
export async function requireTenant(
  orgSlug: string,
  permission?: Permission,
): Promise<TenantContext>;
// 1. Session from cookies (Better Auth getSession). None → redirect to /login.
// 2. Membership lookup by (userId, organization.slug). None → notFound() (404, not 403, to avoid
//    revealing that the organization exists).
// 3. If permission is given → assertCan(role, permission), which throws ForbiddenError (403).
// Returns { userId, organizationId, role } — the only way to obtain a TenantContext.
```

- Every Server Component page, Server Action and route handler under `/o/[orgSlug]` calls
  `requireTenant` first.
- The UI hides controls the role can't use. This is cosmetic; enforcement is on the server.
- Permission matrix tests run for every role and permission pair, using the table in `rbac.ts`.

## 5. Tenant-isolated database queries

A **data access layer** that cannot be called without a tenant:

```ts
// apps/web/src/server/data/index.ts
export function tenantData(ctx: TenantContext) {
  const organizationId = ctx.organizationId;
  return {
    conversations: {
      list: (q: ConversationListQuery) => prisma.conversation.findMany({ where: { organizationId, ...filters(q) }, … }),
      get: (id: string) => prisma.conversation.findFirst({ where: { id, organizationId } }), // never findUnique({ id })
    },
    contacts: { … }, leads: { … }, messages: { … }, members: { … },
  };
}
```

- **Lint enforcement:** an ESLint `no-restricted-imports` rule forbids importing `@ravi/db`'s
  `prisma` anywhere in `apps/web` except `src/server/data/**`, `src/server/auth/**` and the webhook
  route.
- **IDs from the client** (route params, form fields) are always combined with `organizationId`
  in the `where` clause. A record from another tenant returns `null`, and the page returns 404.
- **Writes** (status change, assignment, lead updates) use `updateMany({ where: { id,
organizationId } })` and check that `count === 1`.
- **Pagination** is cursor-based, ordered by `(lastMessageAt desc, id)`, with Zod-validated query
  params.
- **Defense in depth (evaluate, don't block on):** Postgres Row-Level Security with
  `SET LOCAL app.organization_id` inside a transaction. It is documented as an option for Phase 3
  after the repository layer is proven.

## 6. Authenticated dashboard data

Routes move from `/(dashboard)/*` to `/o/[orgSlug]/*`. After login, `/dashboard` redirects to the
user's default organization.

| Page                 | Data                                                                                                               | Permission                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| Overview             | Counts of open and pending conversations, contacts, leads by status, and dead jobs for the org                     | `conversations:read`               |
| Conversations        | Filterable list (status, assignee), thread view with messages and delivery status                                  | `conversations:read`               |
| Conversation actions | Resolve, reopen, assign to a member, and turn AI off for the conversation (turning it **on** is hidden in Phase 2) | `conversations:reply`              |
| Contacts             | List and search, detail with conversations and leads, mark as opted out                                            | `contacts:read` / `contacts:write` |
| Leads                | List, create from a contact, update status, value and notes                                                        | `leads:read` / `leads:write`       |
| Settings → Members   | Members, invitations, roles                                                                                        | `members:manage`                   |
| Settings → WhatsApp  | Read-only account status (phone number, WABA ID, connected or disabled; **never the token**)                       | `settings:manage`                  |

- **Manual agent replies are not in Phase 2 scope.** They send real WhatsApp messages, so they
  move to the start of Phase 3 behind a feature flag. The enqueue path (`whatsapp.send`) already
  exists.
- Message bodies are rendered as plain text (React escapes them), with no HTML rendering of
  customer content.
- Loading and empty states, plus an error boundary per route segment.

## 7. Integration tests for authorization and tenant isolation

A new Vitest project `integration` (`*.int.test.ts`) runs against `ravi_ai_test`:
`globalSetup` runs the safety guard, then `prisma migrate deploy`, and each file truncates the
tables (guarded). Fixtures build two synthetic tenants, **Org A** and **Org B**, each with an
Owner, Admin, Agent and Viewer.

| #   | Scenario                                                               | Expected                                                                                        |
| --- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1   | No session hits any `/o/*` page or action                              | Redirect to `/login`; the action is rejected                                                    |
| 2   | Org A user requests `/o/org-b/...`                                     | 404, no data                                                                                    |
| 3   | Org A user fetches an Org B conversation, contact or lead by ID (IDOR) | `null` from the data layer, 404 page                                                            |
| 4   | Org A user updates an Org B lead or conversation by ID                 | `count === 0`, error, Org B row unchanged                                                       |
| 5   | List queries for Org A                                                 | Never contain Org B rows (asserted on IDs)                                                      |
| 6   | Viewer calls a write action                                            | 403 `ForbiddenError`                                                                            |
| 7   | Agent changes a role or invites a member                               | 403                                                                                             |
| 8   | Admin assigns OWNER                                                    | Rejected                                                                                        |
| 9   | Remove or demote the last owner                                        | Rejected                                                                                        |
| 10  | Invitation token reused, expired, or used with a different email       | Rejected                                                                                        |
| 11  | Session revoked or expired                                             | Next request redirects to login                                                                 |
| 12  | Login brute force                                                      | Rate-limited after the threshold                                                                |
| 13  | Webhook for Org A's phone number                                       | Rows created only under Org A (end-to-end through the worker handler against the test database) |
| 14  | Worker queue `claim()` with two concurrent claimers                    | Each job is claimed exactly once (`SKIP LOCKED`)                                                |
| 15  | Permission matrix                                                      | `can()` and `requireTenant` agree for every role and permission pair                            |

Unit tests remain for pure logic. Integration tests become a required CI job.

## 8. Milestones

| #   | Milestone                  | Deliverables                                                                                                          | Exit criteria                                                   |
| --- | -------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| M1  | Dev and test database + CI | Local databases, `.env.test.example`, safety guard, integration harness, GitHub Actions                               | Phase 1 migration applied to dev; tests 13 and 14 pass in CI    |
| M2  | Authentication             | Better Auth spike, additive auth migration, login and logout pages, `admin:create` CLI, rate limiting, proxy redirect | Tests 1, 11 and 12 pass; security review of cookies and headers |
| M3  | Tenancy core               | `requireTenant`, `tenantData` layer, ESLint import rule, `/o/[orgSlug]` routing, org switcher                         | Tests 2–5 and 15 pass                                           |
| M4  | Organization management    | Settings, members, `Invitation` model and flow, registration modes, audit logging                                     | Tests 6–10 pass                                                 |
| M5  | Dashboard data             | Overview, conversations (list, thread, actions), contacts, leads, WhatsApp status                                     | All tests green; manual QA at phone and desktop widths          |
| M6  | Hardening                  | Review against the OWASP ASVS L1 checklist (auth, session, access control), dependency audit, docs update             | Owner sign-off; PR to `main`                                    |

## 9. Decisions needed from the owner

1. **Auth library.** Better Auth (recommended, auth-only use) or Auth.js v5. Auth.js's stable
   npm release is still v4 (4.24.x), and v5 is not the `latest` tag.
2. **Registration mode at launch.** `closed` (recommended), `invite` or `open`.
3. **Email provider** for verification, password reset and invitations (for example, Resend,
   Postmark, SES, or SMTP). This needs your account and credentials, and production login stays
   blocked until it's configured.
4. **2FA policy.** Optional (recommended for Phase 2), or required for owners and admins.
5. **Manual agent replies.** Keep them deferred to Phase 3 (recommended), or pull them into M5
   behind a flag.

## 10. Risks

| Risk                                                         | Mitigation                                                                                 |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Auth library schema conflicts with the existing `User` model | Spike in M2 before any migration; additive mapping only                                    |
| A missed `organizationId` filter in a new query              | Lint rule, the data layer as the only path, and IDOR integration tests on every new entity |
| Tests run against the wrong database                         | Host and name safety guard before any setup or truncation                                  |
| Proxy-only protection bypass (CVE-2025-29927 class)          | The proxy is never the security boundary; `requireTenant` runs in every handler            |

---

## Implementation status (2026-10-17)

Implemented on `feat/phase-2-auth-tenancy` with the approved decisions: Better Auth 1.7.10, closed
registration, Resend in production with a local outbox, TOTP required for owners and admins,
manual WhatsApp replies deferred, AI replies and live sending disabled.

| Milestone                  | Status | Evidence                                                                                                                                                                                |
| -------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1 PostgreSQL              | Done   | `pnpm db:local` (PostgreSQL 18, dev + test databases), additive migration applied to local dev, no drift, `/api/health/ready`, worker startup check, test-database guard (8 unit tests) |
| M2 Authentication          | Done   | Login and logout, database sessions, verification, password reset, rate limits, secure cookies, CSRF, TOTP and backup codes, owner CLI; 12 integration tests + end-to-end smoke test    |
| M3 Organization management | Done   | Members, role changes, removal and leaving, invitations, org switcher, audit log, last-owner protection (including concurrency); 16 integration tests                                   |
| M4 Tenant isolation        | Done   | `resolveTenant` + tenant data layer + ESLint import ban; 17 integration tests including manipulated IDs                                                                                 |
| M5 Dashboard               | Done   | `/o/[orgSlug]`: overview (live counts), conversations, contacts, leads, team, settings, WhatsApp status; no fabricated statistics                                                       |
| M6 Testing                 | Done   | 73 unit + 52 integration tests; 29-step end-to-end smoke test; Phase 1 tests preserved                                                                                                  |

Deviations from the plan:

- **Registration modes:** only `closed` exists. Invitation acceptance is admin-initiated, so a
  separate `invite` mode was unnecessary. Any public mode needs a new decision.
- **Password hashing:** Better Auth's default scrypt (not argon2id), to avoid a native dependency.
  It can be swapped through `emailAndPassword.password` later.
- **Found and fixed during testing:** (1) Better Auth disables origin and CSRF checks when it
  detects a test environment, so they are now pinned on explicitly; (2) the Phase 1 root `.env`
  loading in `next.config.ts` never took effect (`@next/env` caching); (3) the Phase 1 README was
  corrupted by an encoding mix-up and has been rewritten.

Needs real credentials: Resend delivery, Meta webhook and live messages. AI replies and outbound
sending stay off by design.
