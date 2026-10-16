# Ravi AI — Architecture

## 1. Overview

```
                ┌──────────────────────────┐
  Meta Cloud ──►│ apps/web                 │  Next.js App Router
  API webhook   │  /api/webhooks/whatsapp  │  - GET: subscription verify
                │  /dashboard/*            │  - POST: HMAC verify → enqueue
                └────────────┬─────────────┘
                             │ INSERT "Job" (idempotent dedupe key)
                             ▼
                ┌──────────────────────────┐
                │ PostgreSQL               │  system of record + durable queue
                └────────────┬─────────────┘
                             │ SELECT … FOR UPDATE SKIP LOCKED
                             ▼
                ┌──────────────────────────┐
                │ apps/worker              │  job handlers
                │  whatsapp.webhook        │  → contacts / conversations / messages
                │  ai.reply                │  → RAG + LLM (feature-flagged)
                │  whatsapp.send           │  → Graph API /{phone-number-id}/messages
                └──────────────────────────┘
```

The webhook handler does as little as possible. It verifies the request, persists it and returns
`200`. All business logic runs in the worker, so slow LLM calls or Graph API errors never cause Meta
webhook timeouts. Meta does not lose events either: it keeps retrying any delivery that was not
acknowledged.

## 2. Monorepo layout

| Path                  | Package            | Responsibility                                                                   |
| --------------------- | ------------------ | -------------------------------------------------------------------------------- |
| `apps/web`            | `@ravi/web`        | Dashboard UI, webhook endpoint, health check                                     |
| `apps/worker`         | `@ravi/worker`     | Durable job processing                                                           |
| `packages/db`         | `@ravi/db`         | Prisma schema, migrations, client singleton, account registration script         |
| `packages/validation` | `@ravi/validation` | Zod schemas: environment variables, WhatsApp webhook payloads                    |
| `packages/whatsapp`   | `@ravi/whatsapp`   | Webhook verification, signature check, payload normalisation, Cloud API client   |
| `packages/ai-engine`  | `@ravi/ai-engine`  | LLM provider interface, Anthropic adapter, chunking, retrieval, grounded prompts |
| `packages/core`       | `@ravi/core`       | RBAC permissions, secret encryption, small shared utilities                      |

Tooling: pnpm workspaces, Turborepo for task orchestration and caching, TypeScript (strict), ESLint
(flat config), and Vitest.

Internal packages ship TypeScript source (`exports` points at `src/index.ts`). Next.js compiles them
through `transpilePackages`, and the worker is bundled with tsup, so no separate build step per
package is needed.

## 3. Request flows

### 3.1 Webhook verification (GET)

Meta calls `GET /api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…`.
If `hub.mode === "subscribe"` and the token matches `WHATSAPP_VERIFY_TOKEN` (constant-time
compare), the handler returns the challenge as `text/plain` with status 200. Otherwise it returns 403.

### 3.2 Webhook ingestion (POST)

1. Reject bodies larger than 1 MB (`413`).
2. Read the **raw** body. The signature is computed over the exact bytes, and re-serialising the
   JSON would change escaping.
3. Verify `X-Hub-Signature-256: sha256=<hex>` as HMAC-SHA256(raw body, `WHATSAPP_APP_SECRET`),
   using constant-time comparison. A failed check returns `401`.
4. Parse the JSON and validate the envelope (`object === "whatsapp_business_account"`). A valid
   signature with an unexpected shape is acknowledged with `200` and logged, so that Meta does not
   retry it for days.
5. Insert a `Job` of type `whatsapp.webhook` with `dedupeKey = "wa-webhook:" + sha256(raw body)`
   (`skipDuplicates`), so retried deliveries are ignored.
6. Return `200`. If the database is unavailable, return `500` and Meta retries.

### 3.3 Inbound processing (worker)

`whatsapp.webhook` normalises the payload into `message` and `status` events. For each event:

- Resolve the tenant by `metadata.phone_number_id` → `WhatsAppAccount.organizationId`. Unknown
  numbers are logged and skipped, never auto-created.
- **message:** upsert `Contact (organizationId, waId)`; find or create the open `Conversation`;
  insert `Message` with a unique `(organizationId, waMessageId)` key, which makes it idempotent;
  update the conversation timestamps. If AI auto-reply is enabled at the environment, organization
  and conversation levels, enqueue `ai.reply` (dedupe key `ai-reply:<messageId>`).
- **status:** update the outbound message's status (`sent` → `delivered` → `read`, or `failed` with
  error details). Statuses never move backwards.

### 3.4 AI reply (worker, feature-flagged)

`ai.reply` checks the guards first: the contact has not opted out, the conversation is AI-enabled,
and the last inbound message is inside the 24-hour customer service window. It then retrieves
knowledge chunks for the organization.

- **No relevant knowledge:** no LLM call is made. The conversation is set to `PENDING` for a human.
- **Otherwise:** the engine builds a grounded system prompt and calls the configured `LLMProvider`.
  It stores an outbound `Message` (status `PENDING`, sender `AI`) and enqueues `whatsapp.send`.

### 3.5 Send (worker)

`whatsapp.send` loads the message, skips it if a `waMessageId` already exists (idempotency
on retry), decrypts the account access token, and calls
`POST https://graph.facebook.com/{version}/{phone-number-id}/messages`. It then stores the returned
message ID and sets the status to `SENT`, or `FAILED` for non-retryable Graph API errors.

## 4. Queue design

PostgreSQL is the queue (a `Job` table). This means no extra infrastructure, transactional
consistency with the data model, and durability.

- Claim: `UPDATE … WHERE id IN (SELECT … WHERE status='PENDING' AND "runAt" <= now() ORDER BY "runAt" LIMIT n FOR UPDATE SKIP LOCKED) RETURNING …`.
  Several worker replicas can run safely.
- Retry: exponential backoff with jitter (capped at 15 minutes). After `maxAttempts` the job moves
  to `DEAD` and keeps its last error for inspection.
- Stale locks: jobs `RUNNING` longer than the visibility timeout return to `PENDING`.
- Handlers must be idempotent. Delivery is at-least-once.

If throughput outgrows Postgres polling (thousands of jobs per second), the `JobQueue` interface in
the worker can be backed by a dedicated broker without touching the handlers.

## 5. Multi-tenancy

- Every tenant-owned row carries `organizationId`, and composite unique keys include it.
- Routing is based on the WhatsApp phone number ID. One Meta app (one app secret) can serve many
  business numbers.
- All dashboard data access (Phase 2) goes through a tenant-scoped data layer that takes the
  organization from the authenticated session, never from client input.
- RBAC lives in `@ravi/core` (`can(role, permission)`) and is enforced on the server.

## 6. Security

| Concern                                | Control                                                                                                                                                        |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Forged webhooks                        | HMAC-SHA256 signature over the raw body, constant-time compare                                                                                                 |
| Replay / duplicates                    | Content-hash dedupe key; unique WhatsApp message IDs                                                                                                           |
| Secret exposure                        | Secrets only in server env; no `NEXT_PUBLIC_` secrets; tokens encrypted with AES-256-GCM (`ENCRYPTION_KEY`)                                                    |
| Cross-tenant access                    | `organizationId` on every row and every query; session-derived tenant                                                                                          |
| Prompt injection via customer messages | Customer text is passed only as user content; the system prompt forbids revealing instructions or acting outside scope; the model has no tools or side effects |
| Hallucinated business facts            | Retrieval-grounded prompt; no-context → human handoff, no LLM call                                                                                             |
| Abuse / large payloads                 | 1 MB body limit on the webhook; rate limiting planned at the edge                                                                                              |
| Destructive DB changes                 | Migrations reviewed; `prisma migrate deploy` only; no `reset` in scripts                                                                                       |

## 7. AI engine

- `LLMProvider` interface: `generate({ system, messages, maxTokens }) → { text, stopReason, usage }`.
- Providers: `anthropic` (official `@anthropic-ai/sdk`, default model `claude-opus-5-5`, overridable
  via `AI_MODEL`) and `disabled` (throws, so a misconfigured deployment cannot send replies).
  Other providers implement the same interface.
- RAG: paragraph-aware chunker with overlap → `KnowledgeChunk` rows → `Retriever` interface. Phase 1
  uses Postgres full-text search; Phase 3 adds embeddings with pgvector behind the same interface.

## 8. Observability

Structured JSON logs (one line per event, with job ID, type and organization) from the web app and
the worker. `/api/health` is a liveness check. Metrics and tracing (OpenTelemetry) are planned.

## 9. Deployment (not performed in Phase 1)

- `apps/web`: any Node.js host that supports Next.js (needs a public HTTPS URL with a valid
  certificate for Meta webhooks).
- `apps/worker`: a long-running Node.js process (container, VM or PaaS worker dyno). Scale it
  horizontally.
- PostgreSQL 15+ (managed recommended).
- Migrations: `pnpm db:migrate:deploy` as a release step.
