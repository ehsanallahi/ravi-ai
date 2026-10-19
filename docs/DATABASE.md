# Ravi AI — Database

PostgreSQL 15+ accessed through Prisma ORM. The source of truth is
[packages/db/prisma/schema.prisma](../packages/db/prisma/schema.prisma), and the initial SQL
migration is in `packages/db/prisma/migrations/`.

## Principles

- **Tenant isolation:** every business-owned table has `organizationId`. Uniqueness that matters
  per tenant is a composite key, for example `(organizationId, waId)`.
- **Non-destructive by default:** relations use `onDelete: Restrict`, except knowledge chunks,
  which cascade from their document. Nothing in the codebase deletes tenant data, and deletion
  features will be soft-delete or explicit and audited.
- **Idempotency:** unique keys on `Message (organizationId, waMessageId)` and `Job.dedupeKey` make
  webhook retries and worker re-runs safe.
- **Secrets:** `WhatsAppAccount.accessTokenCiphertext` stores an AES-256-GCM ciphertext
  (`v1:<iv>:<tag>:<data>`, base64). The plaintext token is never stored.
- **IDs:** `cuid()` strings. **Timestamps:** `createdAt`, plus `updatedAt` on mutable rows.

## Entity overview

```
Organization ─┬─< Membership >── User
              ├─< WhatsAppAccount
              ├─< Contact ─┬─< Conversation ─< Message
              │            └─< Lead
              ├─< KnowledgeDocument ─< KnowledgeChunk
              └─< AuditLog
Job (queue; optional organizationId, no FK)
```

## Tables

### Organization

A tenant (one business). `slug` is unique. `aiAutoReplyEnabled` (default `false`) is the
organization-level switch for AI replies. `timezone` is used for business-hours logic later.

### User / Membership

`User.email` is unique and stored lower-cased. `passwordHash` is nullable and reserved for the
Phase 2 auth decision. `Membership (organizationId, userId)` is unique and carries
`role ∈ {OWNER, ADMIN, AGENT, VIEWER}`.

### WhatsAppAccount

One Cloud API phone number. `phoneNumberId` is globally unique and used to route webhooks.
The table also holds `wabaId`, `displayPhoneNumber`, `verifiedName`, `status (ACTIVE | DISABLED)`
and `accessTokenCiphertext`.

### Contact

A WhatsApp user in the context of one organization. It is unique on `(organizationId, waId)`.
`optedOutAt` blocks all automated messages when set. `lastInboundAt` tracks the 24-hour customer
service window.

### Conversation

A thread between a contact and one WhatsApp account. It has
`status ∈ {OPEN, PENDING, RESOLVED}`, where `PENDING` means a human is needed. `aiEnabled` is the
per-conversation switch, `assignedUserId` is optional, and `lastInboundAt` / `lastMessageAt` drive
the inbox ordering. Indexed on `(organizationId, status, lastMessageAt)`.

### Message

`direction (INBOUND | OUTBOUND)`, `senderType (CONTACT | AI | AGENT | SYSTEM)`, `type` (text,
image, …), `body`, `waMessageId`, `status (RECEIVED | PENDING | SENT | DELIVERED | READ | FAILED)`,
error fields, and `metadata` (JSON, used for media IDs and similar). The original WhatsApp
timestamp is kept in `waTimestamp`.

### Lead

A sales opportunity linked to a contact (and optionally a conversation). It has
`status ∈ {NEW, CONTACTED, QUALIFIED, WON, LOST}`, `estimatedValue` (decimal 12,2) with `currency`,
and an optional owner.

### KnowledgeDocument / KnowledgeChunk

The document has a `title`, `sourceType (MANUAL | FILE | URL)`, an optional `sourceUri`, `content`,
`status (DRAFT | PROCESSING | READY | FAILED | ARCHIVED)` and a `checksum` that detects re-uploads.
Chunks are `(documentId, index)` unique, carry `organizationId` for scoped retrieval, and store
`tokenEstimate`. An `embedding vector(...)` column will be added in Phase 3 with pgvector.

### Job

The durable queue: `type`, `payload` (JSON), `status (PENDING | RUNNING | COMPLETED | DEAD)`,
`dedupeKey` (unique, nullable), `attempts` / `maxAttempts`, `runAt`, `lockedAt` / `lockedBy`,
`lastError` and `completedAt`. Indexed on `(status, runAt)`.

### AuditLog

Append-only record of sensitive actions (account connected, token rotated, member role changed,
AI toggled). It stores `action`, `targetType` / `targetId`, an optional actor, and `metadata`.

## Migration workflow

| Command                               | When                                                  | Destructive?                                                                            |
| ------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `pnpm db:generate`                    | After schema changes; also runs on install            | No                                                                                      |
| `pnpm db:migrate:dev --name <change>` | Local development only, against a disposable database | It can prompt to reset a dev database. **Never point it at shared or production data.** |
| `pnpm db:migrate:deploy`              | CI/CD and production                                  | Applies pending migrations only                                                         |
| `pnpm db:studio`                      | Inspect data locally                                  | No                                                                                      |

`prisma migrate reset` and `db push --accept-data-loss` are intentionally **not** exposed as
scripts. Review every generated migration before committing. Any migration that drops or rewrites
columns needs explicit approval and a backup.

## Retention (to be decided)

Message bodies and media metadata are personal data. A per-tenant retention policy, plus export and
delete tooling for data-subject requests, is tracked for Phase 4.

## Phase 2 additions (migration `20261017000000_auth_tenancy`)

Additive only: new tables and new nullable or defaulted columns. Nothing is dropped, renamed or
retyped. It was reviewed with a destructive-statement scan before being applied to the local dev
database, and a read-only `migrate diff` confirms there is no drift.

| Change                                                                    | Purpose                                                            |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `User.emailVerified`, `User.image`, `User.twoFactorEnabled`               | Better Auth user fields                                            |
| `Session` (unique `token`, `expiresAt`, IP, user agent)                   | Database-backed sessions; deleted on sign-out                      |
| `Account` (`providerId = "credential"`, `password` = scrypt hash)         | Email/password credentials                                         |
| `Verification`                                                            | Email-verification and password-reset tokens (expire after 1 hour) |
| `TwoFactor` (encrypted `secret` and `backupCodes`, lockout counters)      | TOTP                                                               |
| `RateLimit` (`key`, `count`, `lastRequest` BigInt)                        | Database-backed rate limiting across replicas                      |
| `Invitation` (`tokenHash` unique, `expiresAt`, `acceptedAt`, `revokedAt`) | Single-use, email-bound invitations                                |

`User.passwordHash` and `User.emailVerifiedAt` from Phase 1 are **deprecated but kept**, to avoid a
destructive migration. Dropping them later needs explicit approval.

Auth tables reference `User` with `ON DELETE CASCADE`, so sessions and credentials disappear with
their user. Users are never deleted by the app; tenant tables keep `RESTRICT`.

### Local databases

`pnpm db:local` runs PostgreSQL 18 from the `embedded-postgres` npm binaries on `127.0.0.1:54329`,
with data in `.data/postgres` (git-ignored). It provides two databases:

- `ravi_ai_dev` for development (`DATABASE_URL`).
- `ravi_ai_test` for manual testing. Automated integration tests use their own throwaway cluster.

The test guard (`assertSafeTestDatabaseUrl`) refuses any truncation, fixture or migration step
unless the host is local **and** the database name ends in `_test`.

## Phase 3 additions (migration `20261019000000_ai_knowledge_rag`)

Additive only. It was checked by the destructive-statement guard, applied to the local dev
database, and a drift check shows none.

| Change                                                                                       | Purpose                                                                                            |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `CREATE EXTENSION IF NOT EXISTS vector`                                                      | pgvector (the server must provide it)                                                              |
| `KnowledgeChunk.embedding vector(768)`, `embeddingModel`                                     | Gemini embeddings; the dimension is fixed by the column                                            |
| `KnowledgeDocument.version`, `indexedAt`, `embeddingModel`, `errorMessage`, `sourceFilename` | Indexing state                                                                                     |
| `Organization.aiDataConsentAt`, `aiDataConsentByUserId`                                      | Owner opt-in before data goes to the AI provider                                                   |
| `Organization.aiMonthlyBudgetUsd`                                                            | Per-organization cap, never above the platform cap                                                 |
| `AiUsageEvent`                                                                               | One row per provider call: model, tokens, dimensions, estimated cost, latency, success, error code |
| `AiSuggestion`                                                                               | Playground answers with sources, decision, cost and review (status, rating, notes)                 |

- **Chunks are derived data.** Re-indexing replaces only that document's chunks, in one
  transaction, after every embedding succeeded. Documents are archived, never deleted.
- **UTF-8 is required.** Windows' `initdb` defaults to WIN1252, which cannot store Urdu. Local
  clusters are created with `--encoding=UTF8`, and test setup refuses non-UTF-8 databases. An older
  local cluster in `.data/postgres` (WIN1252) is left untouched and can be deleted manually; new
  local data lives in `.data/pg-utf8`.
- **No ANN index yet.** Retrieval uses exact cosine search per organization, which is fast for
  typical knowledge bases. An HNSW index will be added in a reviewed migration when needed.
