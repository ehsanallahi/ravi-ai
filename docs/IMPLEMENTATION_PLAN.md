# Ravi AI — Implementation Plan

## Repository analysis (start of Phase 1)

- The repository held one commit (`19d9f2f`) with only `README.md`, a UTF-16 file containing the
  heading `# -ravi-ai` and nothing else. The setup guide replaces it as UTF-8 (requirement 11). The
  original stays in git history.
- There was no existing code, configuration or database to migrate.
- The git remote is `github.com/ehsanallahi/-ravi-ai`. The brief referred to
  `ehsanallahi/ravi-ai`, so confirm which repository is canonical before pushing.

## Phase 1 — Foundation (this phase)

| #   | Deliverable                                                                          | Status                                          |
| --- | ------------------------------------------------------------------------------------ | ----------------------------------------------- |
| 1   | Planning docs (PRD, architecture, database, plan)                                    | Done                                            |
| 2   | pnpm + Turborepo monorepo, strict TypeScript, ESLint, Vitest                         | Done                                            |
| 3   | `apps/web` Next.js App Router + Tailwind v4 + shadcn/ui-style components             | Done                                            |
| 4   | `apps/worker` with a Postgres-backed durable job queue                               | Done                                            |
| 5   | Packages: `db`, `validation`, `whatsapp`, `ai-engine`, `core`                        | Done                                            |
| 6   | Prisma schema + initial SQL migration (generated offline, not applied)               | Done                                            |
| 7   | Responsive dashboard shell (sidebar, mobile drawer, section pages with empty states) | Done                                            |
| 8   | Webhook endpoint: GET verify, POST signature check, idempotent enqueue               | Done                                            |
| 9   | Worker handlers: inbound messages, statuses, AI reply (flagged off), send            | Done, but untested against live Meta / LLM APIs |
| 10  | `.env.example`, README setup guide                                                   | Done                                            |
| 11  | Unit tests for the security-critical paths; build, type-check and lint pass          | Done                                            |

Phase 1 exit criteria needing real infrastructure, which the owner has to run:

- [ ] `pnpm db:migrate:deploy` against a real PostgreSQL database.
- [ ] Register a WhatsApp test number with `pnpm --filter @ravi/db account:register`.
- [ ] Expose the web app over HTTPS (for example, with a tunnel) and verify the webhook in the Meta
      App Dashboard.
- [ ] Send a test message to the number and confirm that Contact, Conversation and Message rows
      appear.

## Phase 2 — Authentication and live inbox

- Choose and implement auth (recommendation: Auth.js or Better Auth with the Prisma adapter, email
  magic link plus optional Google OAuth). Use secure, HttpOnly cookies and CSRF protection.
- Organization creation, invitations and role management, enforced with `can()` on the server.
- Tenant-scoped data access layer: every query takes `organizationId` from the session.
- Inbox: conversation list, message thread, manual reply (enqueues `whatsapp.send`), AI on/off
  toggle per conversation, assignment, and resolve/reopen.
- Settings: WhatsApp account connection form (token encrypted on submit), and an org-level AI
  toggle written to the audit log.
- Webhook rate limiting and alerting on `DEAD` jobs.

## Phase 3 — Knowledge base and RAG quality

- Knowledge UI: create, edit and archive documents; upload text, Markdown and PDF; a
  `knowledge.index` job for chunking.
- pgvector embeddings plus hybrid (full-text and vector) retrieval behind the `Retriever`
  interface.
- Answer-quality review: agents mark AI replies as correct or incorrect, and an evaluation set is
  built from those reviews.
- Handoff detection (the customer asks for a human, or the message is negative or urgent).

## Phase 4 — Sales and analytics

- Lead pipeline (kanban), AI-suggested leads that need agent confirmation, CSV export.
- Metrics: first response time, handoff rate, leads and conversion.
- Data retention settings; export and delete tooling for data-subject requests.

## Phase 5 — Scale and onboarding

- Meta Embedded Signup (Tech Provider) onboarding flow.
- Message templates (approved through Meta) for business-initiated messages, with an opt-in
  ledger.
- Media messages (download through the Graph API media endpoint into object storage).
- OpenTelemetry tracing; a dedicated queue broker if Postgres polling becomes a bottleneck.
- Billing, only after an explicit product decision.

## Technical debt and follow-ups

- Prisma 7 (driver adapters, new generator) is available. The project stays on Prisma 6 until the
  upgrade is planned and tested.
- Add a GIN full-text index on `KnowledgeChunk.content` in a reviewed migration once retrieval is
  live.
- Add integration tests against a disposable Postgres database (Testcontainers or a CI service
  container).
