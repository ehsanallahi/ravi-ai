# Ravi AI — Phase 3 Implementation Plan

**Theme:** Live WhatsApp, a trustworthy knowledge base, and controlled AI replies
**Builds on:** Phase 2 (`feat/phase-2-auth-tenancy`)
**Status:** Proposed. Nothing in this plan may send real messages or use real API credentials
until the owner approves the specific gate (see §9).

## 0. Guardrails (unchanged unless the owner approves a gate)

- **AI replies stay disabled by default** at every level: platform (`AI_AUTO_REPLY_ENABLED=false`),
  organization (`aiAutoReplyEnabled=false`) and conversation. New AI capability ships in **draft
  mode first** (AI suggests, a human sends).
- **No live sending** until gate G1. Sending code is built behind `WHATSAPP_SEND_ENABLED=false`
  and tested against a mocked Graph API.
- **No real credentials** (Meta, Anthropic, embeddings provider, Resend) until gate G2.
  Development uses mocks, recorded fixtures and Meta's test numbers only after G1.
- **Additive migrations only**, reviewed before applying; synthetic data only in test databases.
- **Compliance:** official WhatsApp Cloud API only; 24-hour customer service window; opt-in
  required for business-initiated messages (approved templates); honour opt-outs. Meta's WhatsApp
  Business Solution Terms restrict general-purpose AI assistants. Ravi AI must stay a
  business-specific support and sales assistant. **Re-check the current Meta terms before G1.**

## M1 — Live WhatsApp Cloud API integration

| Task                 | Detail                                                                                                                                                                                                                      |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connection UI        | Owners connect a number in **Settings → WhatsApp**: phone number ID, WABA ID and token (encrypted on submit, never displayed again), with token rotation and disable/enable. Audit-logged. Replaces the CLI for most users. |
| Connection health    | "Test connection" calls `GET /{phone-number-id}` (read-only) to show the verified name, quality rating and messaging limit tier.                                                                                            |
| Manual agent replies | Deferred from Phase 2: reply box in the conversation thread → outbound `Message (PENDING)` → `whatsapp.send` job. Allowed only inside the 24-hour window and never to opted-out contacts; requires `conversations:reply`.   |
| Send controls        | `WHATSAPP_SEND_ENABLED` (platform) **and** a per-account `sendingEnabled` flag (new column, default `false`). Per-organization outbound rate limit; idempotency already exists via `waMessageId`.                           |
| Templates            | Read approved templates from the WABA (read-only). Sending templates outside the window is **not** in Phase 3.                                                                                                              |
| Media                | Download inbound media through the Graph media endpoint into object storage (decision §8.2), with size and type limits and signed URLs for viewing. No public URLs.                                                         |
| Status and errors    | Map Graph error codes (re-engagement, rate limit, quality) to clear UI states and dead-job alerts.                                                                                                                          |
| Testing              | Contract tests against recorded Graph API responses; a staging run against **Meta test numbers only** after G1.                                                                                                             |

**Exit:** with send disabled, the full flow works end to end against a mocked Graph API; with G1
approved, one internal test number sends and receives in staging.

## M2 — Secure knowledge-base management

| Task            | Detail                                                                                                                                                                                                           |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Documents UI    | Create, edit, archive; upload `.txt`, `.md` and `.pdf` (max 10 MB, extension and magic-byte checks). PDF text is extracted in the worker, never on the request path.                                             |
| Review workflow | `DRAFT → IN_REVIEW → READY`. Only `READY` documents are retrievable. Publishing needs `knowledge:write` (Admin or Owner); every transition is audit-logged and versioned (content `checksum`, `version` column). |
| Content safety  | On ingest, flag (not silently drop) instruction-like text ("ignore previous instructions"), URLs, phone numbers and possible PII for reviewer attention.                                                         |
| Isolation       | Every chunk carries `organizationId`; retrieval is tenant-scoped in SQL and covered by IDOR tests like Phase 2's.                                                                                                |
| Indexing job    | A `knowledge.index` job chunks (existing chunker) and embeds; re-indexing is idempotent per document version.                                                                                                    |

## M3 — Retrieval-augmented generation (RAG)

- **Embeddings:** pgvector extension (an additive migration that needs `CREATE EXTENSION`
  approval) with `KnowledgeChunk.embedding vector(n)`. The provider is decision §8.1; Anthropic
  offers no embeddings API, so Voyage AI or a self-hosted model are the candidates.
- **Hybrid retrieval:** Postgres full-text (the Phase 1 retriever) plus vector similarity,
  combined with reciprocal-rank fusion behind the existing `Retriever` interface; a minimum-score
  threshold; top-k ≤ 5.
- **Grounding:** keep the Phase 1 rule that **no relevant knowledge means no LLM call** and a
  handoff. Replies carry source chunk IDs, shown to agents in the thread.
- **Prompt and model versioning:** system prompts are versioned in code; each AI message stores
  the model, prompt version and source chunks.

## M4 — Controlled AI replies

Three modes per organization, the default being **Off**:

1. **Off:** nothing is generated.
2. **Draft:** AI drafts a reply for the agent, who edits or sends it (manual send path from M1).
   No automatic sending. This is the required first mode for every organization.
3. **Auto:** AI replies are sent automatically, only for organizations an owner switches over
   after a draft-mode review period, and only with platform gate G3.

Controls in every mode:

- Output checks before sending or drafting: no prices, URLs, phone numbers or dates that don't
  appear in the source chunks; maximum length; no credential requests. A failed check becomes a
  handoff.
- Limits: at most N AI replies per conversation per hour, and per-organization daily token and
  cost budgets with hard stops.
- Kill switches at platform, organization and conversation level, plus an AI disclosure line
  configurable per organization.
- The model is `claude-opus-5-5` by default (configurable), with refusal fallbacks enabled.
  Effort is tuned with evals (M7), not by guesswork.

## M5 — Human handoff

- Handoff triggers: no knowledge, the customer asks for a human, negative sentiment or complaint,
  failed output checks, model handoff token, legal/medical/payment topics, repeated
  misunderstanding.
- On handoff: the conversation becomes `PENDING`, AI pauses for it, assignment rules (round-robin
  or unassigned queue) apply, and the team is notified by email (Resend, after G2). An optional
  customer message ("A team member will reply shortly") is sent only if sending is approved.
- Inbox: live updates (polling or server-sent events), SLA timers, filters, and "return to AI"
  (Owner or Admin only).

## M6 — Observability

- OpenTelemetry traces across webhook → queue → worker → LLM → Graph API, with job and
  organization IDs as attributes (never message bodies).
- Metrics: webhook latency, queue depth and age, dead jobs, send failures by Graph code, AI
  drafts, sends and handoffs, retrieval hit rate, token usage and cost per organization.
- Structured logs with request IDs and PII redaction (phone numbers hashed, bodies excluded).
- Alerts: dead jobs > 0, webhook 5xx, Graph quality-rating drops, budget at 80%, auth anomalies
  (throttle spikes).
- Ops dashboard for platform operators (separate from tenant dashboards).

## M7 — Safety evaluations

- **Eval set:** synthetic conversations per vertical, plus reviewed real transcripts only with
  tenant consent and PII removed. Categories: answerable, unanswerable (must hand off), prompt
  injection (customer and document), price and policy traps, multilingual, abusive input.
- **Metrics:** groundedness (claims supported by sources), unsupported-claim rate (target ≈ 0),
  correct-handoff rate, injection resistance, tone and length.
- **Harness:** offline runner with an LLM judge plus deterministic checks; results stored per
  prompt and model version.
- **Gates:** draft mode and auto mode each need a passing eval run. Auto mode needs, for example,
  0 unsupported prices or policies in the set and ≥ 95% correct handoffs (thresholds to confirm).
- **CI:** a nightly, cost-capped eval job (manual trigger, not on every PR) that needs gate G2
  keys. The deterministic checks run on every PR.
- **Human review:** agents rate drafts (👍/👎 + reason); low-rated replies feed the eval set.

## 8. Decisions needed

1. Embeddings provider (Voyage AI or self-hosted) and vector dimension.
2. File and media storage (S3-compatible bucket; region and retention).
3. Draft-review period before auto mode is allowed, and the eval thresholds.
4. Per-organization AI budget defaults.
5. The staging environment and the Meta test number to use for G1.

## 9. Approval gates (each needs explicit owner approval)

| Gate                            | Unlocks                                                                              | Prerequisites                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| **G1 — Live sending (staging)** | `WHATSAPP_SEND_ENABLED=true` in staging for one internal test number                 | M1 complete, mocked end-to-end tests green, Meta terms re-checked |
| **G2 — Real API credentials**   | Meta, embeddings, Anthropic and Resend keys in a secrets manager (never in the repo) | Secret scanning in CI, budget caps implemented                    |
| **G3 — AI auto mode**           | Auto mode selectable for a named organization                                        | M4 + M7 gates passed, draft mode reviewed                         |
| **G4 — Production rollout**     | Production deployment                                                                | Security review update, runbooks, alerts live                     |

## 10. Risks

| Risk                                        | Mitigation                                                                       |
| ------------------------------------------- | -------------------------------------------------------------------------------- |
| Hallucinated prices or policies             | Grounding, output checks, draft-first, evals                                     |
| Prompt injection via customers or documents | Content isolation in the prompt, document review and flagging, injection evals   |
| Meta policy or quality-rating penalties     | Draft-first, rate limits, opt-out handling, quality monitoring, re-checked terms |
| Runaway LLM cost                            | Per-organization budgets with hard stops; cost metrics and alerts                |
| Cross-tenant leakage in retrieval           | Tenant-scoped SQL, IDOR and retrieval isolation tests                            |

## 11. Carry-overs from Phase 2

- CSP `script-src` with nonces; notify the account owner when sign-in is throttled; scrub
  `/invite/*` paths from logs.
- Prisma 7 upgrade (planned and tested separately).
- Optionally drop the deprecated `User.passwordHash` and `User.emailVerifiedAt` columns. This is a
  destructive migration and needs explicit approval.
