# Ravi AI

[![CI](https://github.com/ehsanallahi/ravi-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/ehsanallahi/ravi-ai/actions/workflows/ci.yml)

WhatsApp AI customer support and sales automation, built on the **official Meta WhatsApp Cloud
API**. Owned by Ravi Stack. This is a standalone product, independent of the Ravi Stack agency
website.

> **Status: Phase 2 (authentication and tenancy).** Sign-in, required TOTP for owners and admins,
> organizations, roles, invitations, tenant-isolated data access and the database-backed dashboard
> are implemented and tested against a real PostgreSQL database. **AI replies and live WhatsApp
> sending stay disabled.** Nothing has been tested against live Meta, Resend or LLM APIs; that
> needs your credentials (see [Verification status](#verification-status)).

- Product: [docs/PRD.md](docs/PRD.md)
- Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Database: [docs/DATABASE.md](docs/DATABASE.md)
- Security review: [docs/SECURITY.md](docs/SECURITY.md)
- Roadmap: [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) ·
  Phase 2: [docs/PHASE_2_PLAN.md](docs/PHASE_2_PLAN.md)

## Stack

pnpm workspaces · Turborepo · TypeScript (strict) · Next.js 16 App Router · Tailwind CSS v4 ·
shadcn/ui-style components · PostgreSQL + Prisma 6 · Better Auth 1.7 (email/password + TOTP) ·
Resend (email) · Zod · Vitest · ESLint 9 · Anthropic SDK (pluggable LLM provider).

## Repository layout

```
apps/
  web/          Next.js app: auth pages, /o/[orgSlug] dashboard, WhatsApp webhook, health checks
    src/server/   auth (Better Auth), tenancy (central authorization), data (tenant-scoped
                  queries), services (organizations, members, invitations), email
  worker/       Background worker: Postgres-backed durable job queue and handlers
packages/
  db/           Prisma schema, migrations, client, health check, account registration script
  validation/   Zod schemas: environment variables, WhatsApp webhook payloads
  whatsapp/     Signature/subscription verification, payload normalisation, Cloud API client
  ai-engine/    LLM provider interface, Anthropic adapter, chunking, retrieval, grounded prompts
  core/         RBAC, AES-256-GCM secret encryption, logger, shared job types
  testing/      Local PostgreSQL (embedded binaries), test-database guard, fixtures
docs/           PRD, architecture, database, implementation plans
```

## Prerequisites

- Node.js **22.9+** (see `.nvmrc`)
- pnpm 10, pinned in `package.json` (`packageManager`). Enable it with `corepack enable` (from an
  administrator shell on Windows if Node is installed under Program Files).
- PostgreSQL 15+. For local development, `pnpm db:local` runs a real PostgreSQL 18 from npm
  binaries; no Docker or system install is needed. A managed instance or
  [docker-compose.yml](docker-compose.yml) also works.

## Local setup

```bash
# 1. Install dependencies (also generates the Prisma client)
pnpm install

# 2. Start local PostgreSQL in its own terminal. The first run creates ravi_ai_dev and
#    ravi_ai_test, generates a local-only password, and prints both connection strings.
pnpm db:local

# 3. Configure the environment. Never commit .env.
cp .env.example .env
#    DATABASE_URL:        the ravi_ai_dev URL printed by `pnpm db:local`
#    BETTER_AUTH_SECRET:  openssl rand -base64 32
#    ENCRYPTION_KEY:      openssl rand -base64 32
#    EMAIL_PROVIDER:      "outbox" locally (emails are written to .data/outbox, nothing is sent)

# 4. Review, then apply the migrations (additive only; see docs/DATABASE.md)
pnpm db:migrate:deploy

# 5. Create the first owner and organization. The password is typed at a hidden prompt.
pnpm --filter @ravi/web owner:create \
  --email you@company.com --name "Your Name" \
  --org-name "Your Business" --org-slug your-business

# 6. Run the app (and, optionally, the worker)
pnpm --filter @ravi/web dev       # http://localhost:3000
pnpm --filter @ravi/worker dev
```

Then:

1. Open the verification email in `.data/outbox/` (newest `*-verify-email.json`) and visit its link.
2. Sign in at `/login`. Owners and admins are sent to **Account → Security** to set up an
   authenticator app before they can open the organization. TOTP is required for those roles.
3. Invite teammates from **Team**. With the outbox adapter, the invitation link is also shown
   once in the UI so you can test it locally.

### Production email (Resend)

Set `EMAIL_PROVIDER="resend"`, `RESEND_API_KEY` and `EMAIL_FROM` (a sender on a domain you verified
in Resend). The app refuses to start authentication in production with the outbox adapter or a
non-https `BETTER_AUTH_URL`.

### Connecting the Meta webhook (unchanged from Phase 1)

1. Expose the web app over **HTTPS with a valid certificate** (a tunnel such as `cloudflared` works
   for testing).
2. In the Meta App Dashboard → **WhatsApp → Configuration → Webhook**, set the callback URL
   `https://<your-host>/api/webhooks/whatsapp` and the verify token `WHATSAPP_VERIFY_TOKEN`.
3. Subscribe to the **`messages`** field.
4. Register the number for an organization:
   `pnpm --filter @ravi/db account:register --org-slug your-business --org-name "Your Business" --phone-number-id <ID> --waba-id <WABA_ID>`
   (the token is read from `WHATSAPP_ACCESS_TOKEN` and stored encrypted).

Inbound messages then appear under **Conversations** and **Contacts** for that organization only.

## Security model

- **Closed registration.** Public sign-up is disabled in Better Auth. Accounts are created only by
  the owner CLI or by accepting an invitation.
- **Sessions** are stored in the database with HttpOnly, `SameSite=Lax` cookies (`Secure` and
  `__Secure-` in production). They expire after 7 days and are revoked on sign-out and on password
  reset. There is no cookie cache, so revocation takes effect on the next request.
- **CSRF.** Better Auth's origin and CSRF checks are pinned on (its default disables them in test
  environments), and Next.js Server Actions check the origin.
- **Rate limits** are stored in the database, so they work across replicas: sign-in 5/min, TOTP
  5/min, password reset 3 per 5 minutes, and more.
- **2FA (TOTP)** is required for Owner and Admin roles. Secrets and backup codes are encrypted with
  `BETTER_AUTH_SECRET`.
- **Central authorization.** `resolveTenant()` is the only way to get a `TenantContext`, and
  checks the session, verified email, membership, 2FA and permission. Every tenant query takes
  that context and filters by its `organizationId`; updates use `updateMany({ id, organizationId })`.
  Foreign or missing IDs both return 404. ESLint forbids importing Prisma in pages, components and
  actions.
- **Last owner.** An organization always keeps at least one owner, enforced with row locks
  against concurrent demotions.
- **Invitations** are single-use, expire after 7 days, are bound to one email, and only the
  SHA-256 of the token is stored.
- **WhatsApp tokens** are never selected by any dashboard query; pages only show whether one is
  stored.
- **Audit log** for organization, member, invitation, conversation, contact and lead changes.

## Scripts

| Command                  | What it does                                                    |
| ------------------------ | --------------------------------------------------------------- |
| `pnpm dev`               | Web app and worker in watch mode                                |
| `pnpm build`             | Production build (Next.js + tsup worker bundle)                 |
| `pnpm typecheck`         | `tsc --noEmit` in every package                                 |
| `pnpm test`              | Unit tests                                                      |
| `pnpm test:integration`  | Integration tests against a throwaway PostgreSQL (see below)    |
| `pnpm lint`              | ESLint over the repository                                      |
| `pnpm check`             | Lint, type-check, unit tests, integration tests and build       |
| `pnpm db:local`          | Local PostgreSQL for development (`.data/postgres`, port 54329) |
| `pnpm db:migrate:deploy` | Applies pending migrations                                      |
| `pnpm db:migrate:dev`    | Creates a migration. **Local, disposable databases only.**      |
| `pnpm db:studio`         | Prisma Studio                                                   |

There are intentionally no scripts for `migrate reset` or `db push --accept-data-loss`.

### Integration tests

`pnpm test:integration` starts a **separate throwaway PostgreSQL cluster** in a temp directory,
applies the migrations with `migrate deploy`, runs the tests and deletes the cluster. Your dev
database is never touched. To use an existing database instead (for example, a CI service
container), set `TEST_DATABASE_URL`. Every destructive test operation is guarded: it refuses any
database that is not on localhost or whose name does not end in `_test`.

## Verification status

Results from this repository, Phase 2:

| Check                                                        | Result                                                                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `pnpm lint`                                                  | ✅ no findings (including the Prisma-import ban, verified with a probe file)               |
| `pnpm typecheck`                                             | ✅ all 9 packages                                                                          |
| `pnpm test` (unit)                                           | ✅ 87 tests                                                                                |
| `pnpm test:integration` (real PostgreSQL 18)                 | ✅ 56 tests: auth 16, tenancy 17, organizations 16, worker 7                               |
| `pnpm build`                                                 | ✅ all authenticated routes render dynamically                                             |
| `prisma validate`, migration drift, `migrate status`         | ✅ valid, no drift, up to date on local `ravi_ai_dev`                                      |
| End-to-end smoke test (dev server, local test database)      | ✅ 29/29: owner CLI, verification, sign-in, required 2FA, backup code, 404s, CSRF          |
| Secret scan (gitleaks, full history) and `pnpm audit --prod` | ✅ no leaks; no known production vulnerabilities (dev-only advisories in docs/SECURITY.md) |
| GitHub Actions CI                                            | See the badge and the PR checks                                                            |

Waiting for real credentials (not verified):

- **Resend** email delivery (the adapter is written; only the local outbox was exercised).
- **Meta** webhook verification and live inbound delivery to a real number.
- Outbound WhatsApp sends and **AI replies**. Both are intentionally disabled in this phase.
- The `docker-compose.yml` file. Docker was not available in the build environment.
