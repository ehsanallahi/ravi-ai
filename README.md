# Ravi AI

[![CI](https://github.com/ehsanallahi/ravi-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/ehsanallahi/ravi-ai/actions/workflows/ci.yml)

WhatsApp AI customer support and sales automation, built on the **official Meta WhatsApp Cloud
API**. Owned by Ravi Stack. This is a standalone product, independent of the Ravi Stack agency
website.

> **Status: Phase 3 in progress (Gemini knowledge base and AI playground).** Phase 2 auth and
> tenancy is complete. The knowledge base (pgvector), Google Gemini RAG and the AI playground are
> implemented and tested with mocked AI. **Automatic WhatsApp replies and live sending stay
> disabled.** Nothing has been tested against live Gemini, Meta or Resend APIs; that needs your
> credentials (see [Verification status](#verification-status)).

- Product: [docs/PRD.md](docs/PRD.md)
- Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Database: [docs/DATABASE.md](docs/DATABASE.md)
- Security review: [docs/SECURITY.md](docs/SECURITY.md)
- Roadmap: [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) ·
  Phase 2: [docs/PHASE_2_PLAN.md](docs/PHASE_2_PLAN.md) · Phase 3: [docs/PHASE_3_PLAN.md](docs/PHASE_3_PLAN.md)

## Stack

pnpm workspaces · Turborepo · TypeScript (strict) · Next.js 16 App Router · Tailwind CSS v4 ·
shadcn/ui-style components · PostgreSQL + Prisma 6 · Better Auth 1.7 (email/password + TOTP) ·
Resend (email) · Google Gen AI SDK (Gemini chat + embeddings) · pgvector · Zod · Vitest · ESLint 9.

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
  ai-engine/    Provider interfaces, Gemini chat/embedding adapters, grounded prompts, safety checks,
                pricing, chunking
  knowledge/    Knowledge base: extraction (txt/md/pdf), pgvector indexing, hybrid retrieval,
                AI usage limits and cost tracking, assistant pipeline, ai:check / ai:eval scripts
  core/         RBAC, AES-256-GCM secret encryption, logger, shared job types
  testing/      Local PostgreSQL (embedded binaries + pgvector), test-database guards, fixtures
docs/           PRD, architecture, database, implementation plans
```

## Prerequisites

- Node.js **22.9+** (see `.nvmrc`)
- pnpm 10, pinned in `package.json` (`packageManager`). Enable it with `corepack enable` (from an
  administrator shell on Windows if Node is installed under Program Files).
- PostgreSQL 15+ with the **pgvector** extension and **UTF-8** encoding. For local development,
  `pnpm db:local` runs a real PostgreSQL 18 from npm binaries (no Docker or system install). On
  Windows, `pnpm db:pgvector:setup` builds pgvector once (needs Visual Studio's C++ tools);
  elsewhere use the `pgvector/pgvector` Docker image.

## Local setup

```bash
# 1. Install dependencies (also generates the Prisma client)
pnpm install

# 2. (Windows, once) Build pgvector for the local PostgreSQL
pnpm db:pgvector:setup

#    Start local PostgreSQL in its own terminal. The first run creates ravi_ai_dev and
#    ravi_ai_test, generates a local-only password, and prints both connection strings.
pnpm db:local

# 3. Configure the environment. Never commit .env.
cp .env.example .env
#    DATABASE_URL:        the ravi_ai_dev URL printed by `pnpm db:local`
#    BETTER_AUTH_SECRET:  openssl rand -base64 32
#    ENCRYPTION_KEY:      openssl rand -base64 32
#    EMAIL_PROVIDER:      "outbox" locally (emails are written to .data/outbox, nothing is sent)
#    GEMINI_API_KEY:      optional; enables the knowledge base and AI playground (server-side only)

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

### AI with Google Gemini (optional)

1. Put a **paid-tier** Gemini API key in `.env` as `GEMINI_API_KEY`. It stays on the server.
   Google may use free-tier data to improve its products.
2. `pnpm ai:check` confirms which models your key can access, and that the chat model, the
   embedding model and the 768 dimensions work. It sends synthetic text only.
3. `pnpm ai:eval -- --models gemini-3.1-flash-lite,gemini-3.5-flash-lite --yes` compares models
   on synthetic English, Urdu and Roman Urdu cases (a few cents). Safety (unsafe or unsupported
   answers) is reported separately from quality.
4. `pnpm ai:kb-test` runs an end-to-end knowledge-base check against the local dev database with
   fictional data: it creates two new demo organizations and never changes existing records. It
   needs `AI_PROVIDER=gemini` (for one run: `AI_PROVIDER=gemini pnpm ai:kb-test`). Results are in
   `docs/PHASE_3_VERIFICATION.md`.
5. In the app, an **owner** enables AI data processing under **Settings**. Admins then add
   documents under **Knowledge base**, index them, and test answers in the **AI playground**.

The assistant answers only from indexed knowledge and cites its sources. It hands off when it is
unsure, when asked for a person, or when a draft states a price, number or link that is not in the
sources. Every call is metered against the organization's monthly budget. **Nothing in the
playground is sent to WhatsApp, and automatic replies stay off (`AI_AUTO_REPLY_ENABLED=false`).**

### Production email (Resend)

Set `EMAIL_PROVIDER="resend"`, `RESEND_API_KEY` and `EMAIL_FROM` (a sender on a domain you verified
in Resend). The app refuses to start authentication in production with the outbox adapter or a
non-https `BETTER_AUTH_URL`.

### Connecting the Meta webhook

See [docs/WHATSAPP_SETUP.md](docs/WHATSAPP_SETUP.md) for the variables, the read-only connection
check, the tunnel and the inbound test plan. In short:

1. `pnpm whatsapp:check` verifies your configuration and, with read-only Graph API calls, the
   phone number, the WhatsApp Business Account and the webhook subscription.
2. Register the number for an organization:
   `pnpm --filter @ravi/db account:register --org-slug your-business --org-name "Your Business"`
   (IDs default to `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_BUSINESS_ACCOUNT_ID`; the token is read
   from `WHATSAPP_ACCESS_TOKEN` and stored encrypted).
3. `pnpm whatsapp:simulate -- --text "..."` posts a signed fictional message to the local webhook.
4. Expose the app over HTTPS (e.g. `cloudflared tunnel --url http://localhost:3000`) and set the
   callback URL `https://<host>/api/webhooks/whatsapp`, the verify token `WHATSAPP_VERIFY_TOKEN`,
   and the `messages` field in Meta App Dashboard → WhatsApp → Configuration.

Inbound messages then appear under **Conversations** and **Contacts** for that organization only.
With `AI_DRAFT_REPLIES_ENABLED=true`, Gemini also writes a draft reply for review on the
conversation page. **Drafts are never sent.**

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

| Command                  | What it does                                                          |
| ------------------------ | --------------------------------------------------------------------- |
| `pnpm dev`               | Web app and worker in watch mode                                      |
| `pnpm build`             | Production build (Next.js + tsup worker bundle)                       |
| `pnpm typecheck`         | `tsc --noEmit` in every package                                       |
| `pnpm test`              | Unit tests                                                            |
| `pnpm test:integration`  | Integration tests against a throwaway PostgreSQL (see below)          |
| `pnpm lint`              | ESLint over the repository                                            |
| `pnpm check`             | Lint, type-check, unit tests, integration tests and build             |
| `pnpm db:local`          | Local PostgreSQL for development (`.data/pg-utf8`, port 54329)        |
| `pnpm db:pgvector:setup` | Windows: builds pgvector for the local PostgreSQL (once)              |
| `pnpm ai:check`          | Verifies your Gemini key, models and dimensions (synthetic text only) |
| `pnpm ai:eval`           | Synthetic multilingual model evaluation (needs `--yes`; costs cents)  |
| `pnpm ai:kb-test`        | Real-Gemini knowledge-base test on the dev DB with fictional data     |
| `pnpm whatsapp:check`    | Read-only WhatsApp Cloud API connection diagnostic (no messages)      |
| `pnpm whatsapp:simulate` | Posts a signed fictional inbound message to the local webhook         |
| `pnpm db:migrate:deploy` | Applies pending migrations                                            |
| `pnpm db:migrate:dev`    | Creates a migration. **Local, disposable databases only.**            |
| `pnpm db:studio`         | Prisma Studio                                                         |

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
