# Ravi AI — Phase 3 Implementation Plan

**Theme:** Live WhatsApp, a trustworthy knowledge base, and controlled AI replies
**AI provider:** **Google Gemini only** (Google Gen AI SDK `@google/genai`); Anthropic and Voyage
are removed. The provider interfaces stay neutral, so another provider can be added later.
**Status:** In progress on `feat/phase-3-gemini-rag`. §1 (Gemini, RAG, playground) is
implemented and tested with mocks. Everything that sends real messages or uses real credentials
still waits for the gates in §9.

## 0. Guardrails

- **AI replies stay disabled by default** at every level: `AI_AUTO_REPLY_ENABLED=false`,
  `Organization.aiAutoReplyEnabled=false`, and the per-conversation switch.
- **No live WhatsApp sending** until gate G1. Approving a playground answer is an evaluation record
  only; no code path turns it into a WhatsApp message.
- **No real credentials in the repository or CI.** `GEMINI_API_KEY` lives only in the server
  environment (`.env`, git-ignored, or a secrets manager). It is never prefixed `NEXT_PUBLIC_`,
  never logged and never rendered.
- **Explicit opt-in:** an Owner must enable "AI data processing" per organization before any text is
  sent to Gemini. Revoking it stops all further calls immediately.
- **Per-organization limits:** a monthly USD budget (organizations may lower the platform cap,
  never raise it) and an hourly request cap.
- **Automated tests never call Gemini:** a mocked SDK client, a deterministic fake embedder and a
  scripted chat model.
- **Additive migrations only;** UTF-8 databases only (Urdu requires it).

## 1. Gemini integration, RAG and AI playground (implemented)

### 1.1 Models (verified 2026-10-19 against Google's official docs)

| Use                      | Default                 | Why                                                                                     | Price (paid tier, per 1M tokens) |
| ------------------------ | ----------------------- | --------------------------------------------------------------------------------------- | -------------------------------- |
| Customer-support replies | `gemini-3.1-flash-lite` | Stable; the cheapest current stable text model; low latency                             | $0.25 input / $1.50 output       |
| Alternative              | `gemini-3.5-flash-lite` | Stable; Google's recommended cost-efficient model for new projects                      | $0.30 / $2.50                    |
| Embeddings               | `gemini-embedding-2`    | Stable; 100+ languages; flexible 128–3072 dimensions (768 recommended); auto-normalised | $0.20 (text input)               |

- **Thinking:** `thinkingLevel: "minimal"` for Gemini 3.x (fastest and cheapest; thinking tokens
  are billed as output). Temperature is not sent, because Gemini 3.6+ ignores it.
- **Final choice:** run `pnpm ai:check` (lists the models your key can access, verifies actions and
  dimensions) and `pnpm ai:eval -- --models gemini-3.1-flash-lite,gemini-3.5-flash-lite --yes`
  (synthetic multilingual evaluation: accuracy, latency, cost). Pick the cheapest model that passes
  every safety case. Sources: [models](https://ai.google.dev/gemini-api/docs/models),
  [pricing](https://ai.google.dev/gemini-api/docs/pricing),
  [embeddings](https://ai.google.dev/gemini-api/docs/embeddings).
- **Data use:** Google's pricing page states that free-tier content may be used to improve its
  products, while paid-tier content is not. **Use a paid-tier key for any business or customer
  data.**

### 1.2 Embeddings and pgvector

- The column is `KnowledgeChunk.embedding vector(768)` (pgvector). `GEMINI_EMBEDDING_DIMENSIONS` is
  validated against it at startup; changing it needs a migration and a re-index.
- `gemini-embedding-2` takes task prefixes in the text, not `taskType`:
  - queries: `task: search result | query: …`
  - documents: `title: … | text: …`
- Every returned vector is checked for the expected length and finite values before storage.
- Retrieval is **organization-scoped hybrid search** over `READY` documents: pgvector cosine
  similarity (threshold `AI_RETRIEVAL_MIN_SIMILARITY`, default 0.55) plus PostgreSQL full-text
  (`simple` config, which works for English, Urdu and Roman Urdu), fused with reciprocal-rank
  fusion. Exact search is used, with no ANN index yet; an HNSW index is added when a tenant
  exceeds ~50k chunks.
- **Local:** `pnpm db:pgvector:setup` builds pgvector 0.8.7 for the embedded PostgreSQL 18 with
  Visual Studio. **CI:** the `pgvector/pgvector:0.8.7-pg16` image.

### 1.3 Pipeline

1. **Ingest:** paste text, or upload `.txt`, `.md` or `.pdf` (≤ 5 MB, type checked by file
   signature, text extracted on the server). Stored as a `DRAFT`, with duplicates detected by
   checksum.
2. **Index** (Owner or Admin, consent required): chunk (≈1,500 characters with overlap), embed in
   batches, then replace this document's chunks in one transaction → `READY`. Failures mark the
   document `FAILED` with a safe message and keep the previous chunks.
3. **Answer:**
   - A request for a human (English, Roman Urdu or Urdu) hands off immediately, without a model
     call.
   - Retrieval runs next. With no relevant knowledge, the conversation hands off without a model
     call.
   - Otherwise Gemini answers with **structured JSON**: answer, handoff, reason, cited source IDs
     and language.
4. **Safety checks after generation:**
   - Every multi-digit number (price, stock, phone, date) and every URL in the answer must appear
     exactly in the sources or the customer's message; otherwise the draft is withheld and the
     conversation hands off.
   - Refusals and malformed output also hand off.
5. **Review:** each answer is stored as an `AiSuggestion` with the retrieved sources (cited or
   not), model, language, cost and latency. Admins rate it (1–5), add notes, and approve or reject.
   This sends nothing.

### 1.4 Usage, cost and errors

Every provider call writes an `AiUsageEvent`: feature, operation, model, input, output and
thinking tokens, embedding dimensions, estimated USD cost, latency, success, and a short error code
such as `http_429` (never prompt or document text). Costs use the official price table (date-tiered
where Google announces changes). Unknown models are refused unless price overrides are set, so
budgets stay enforceable.

### 1.5 Dashboard

- **Knowledge base:** add, view chunks, index, re-index, archive and restore.
- **AI playground** (Owner or Admin): ask, see the answer or handoff reason, the withheld draft and
  the retrieved knowledge with similarity, then evaluate.
- **Settings → AI:** owner consent, monthly budget, usage this month, and the requests in the last
  hour.

## 2. M1 — Live WhatsApp Cloud API integration (not started)

- **Connection UI:** owners enter the phone number ID, WABA ID and token (encrypted on submit,
  never displayed). "Test connection" uses read-only Graph calls. Token rotation; audit log.
- **Manual agent replies:** only inside the 24-hour window and never to opted-out contacts.
  Sending is gated by `WHATSAPP_SEND_ENABLED` and a per-account `sendingEnabled` flag.
- **Media:** download through the Graph media endpoint into private object storage.
- **Tests:** contract tests against recorded responses, then a staging run on Meta test numbers
  after G1.

## 3. M2 — AI draft mode for real conversations (after G2)

- The worker builds suggestions for inbound conversations as `AiSuggestion(source="conversation")`.
- Agents edit, then send through the manual reply path from M1. No automatic sending.
- Prerequisites: G1 and G2, plus organization consent. Customer messages are only sent to Gemini
  once the owner's consent explicitly covers conversation data (a separate consent scope,
  `aiConversationConsentAt`).

## 4. M3 — Controlled automatic replies (after G3)

- Auto mode per organization, only after a draft-mode review period and passing evaluations (§7).
- Limits: per-conversation hourly cap, per-organization budget with hard stop, and kill switches at
  platform, organization and conversation level.
- An AI disclosure line, configurable per organization.

## 5. M4 — Human handoff

- Triggers: no knowledge, a request for a person, complaints, sensitive topics, failed safety checks
  and model handoff. All are implemented in the reply engine.
- On handoff: the conversation becomes `PENDING`, AI pauses for it, assignment rules apply, the team
  is notified by email (Resend, after G2), and the inbox shows SLA timers.

## 6. M5 — Observability

- OpenTelemetry traces: webhook → queue → worker → Gemini → Graph API (IDs only, no message
  bodies).
- Metrics: queue depth, dead jobs, send failures, AI calls, handoff rate, retrieval hit rate, and
  cost per organization.
- Alerts: dead jobs, webhook 5xx, Gemini 429 or 5xx spikes, budget at 80%, quality-rating drops.

## 7. M6 — Safety evaluations

- `pnpm ai:eval` covers synthetic cases for answerable questions in English, Urdu and Roman Urdu,
  unlisted prices, stock levels, invented discounts, prompt injection, requests for a human, and
  off-topic questions.
- Gates: draft mode needs ≥ 90% correct decisions and 0 unsupported claims. Auto mode needs ≥ 95%
  correct handoffs and 0 unsupported prices or policies across ≥ 200 reviewed real drafts.
- Reviewer ratings from the playground and draft mode feed the evaluation set; transcripts are
  reviewed only with consent and with PII removed.

## 8. Decisions still needed

1. Confirm the chat model after `pnpm ai:eval` on your key.
2. Private object storage for uploads and media (bucket and region).
3. The draft-review period before auto mode, and final evaluation thresholds.
4. A separate consent scope for sending customer conversation data to Gemini.

## 9. Approval gates

| Gate                            | Unlocks                                                       | Prerequisites                                                     |
| ------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------- |
| **G1 — Live sending (staging)** | `WHATSAPP_SEND_ENABLED=true` for one internal test number     | M1 complete; mocked end-to-end tests green; Meta terms re-checked |
| **G2 — Real credentials**       | Gemini (paid tier), Meta and Resend keys in a secrets manager | CI secret scanning, budgets and consent (done)                    |
| **G3 — AI auto mode**           | Auto mode for a named organization                            | Draft mode reviewed; §7 thresholds met                            |
| **G4 — Production rollout**     | Production deployment                                         | Updated security review, runbooks, alerts                         |

## 10. Risks

| Risk                                    | Mitigation                                                                |
| --------------------------------------- | ------------------------------------------------------------------------- |
| Hallucinated prices, stock or policies  | Grounded prompt, exact-number checks, handoff, evals                      |
| Prompt injection (customer or document) | Sources delimited as data, structured output, injection evals             |
| Cost overrun                            | Per-organization monthly budget and hourly cap; refusal of unknown models |
| Data protection                         | Owner opt-in, paid tier, server-only key, no prompt text in logs          |
| Cross-tenant leakage                    | Organization-scoped SQL on chunk and document, IDOR tests                 |
| Model or price changes                  | Stable model IDs, `pnpm ai:check`, a price table with a verification date |
