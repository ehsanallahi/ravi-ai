# Phase 3 verification: Gemini AI and knowledge base

Branch: `feat/phase-3-gemini-rag` · Last updated: 2026-10-19

This document records what has been verified for Phase 3 and how. **Real Gemini API results are
still PENDING**: no `GEMINI_API_KEY` was configured when this was written, so no real API call has
been made yet. Everything marked "verified" below was tested offline (deterministic test doubles,
or the real `@google/genai` SDK against a local mock HTTP server) and against real local
PostgreSQL 18.4 with pgvector 0.8.7. Mocked tests are **not** a substitute for the real API
results in sections 2 and 3.

## 1. Status at a glance

| Area                                      | Status                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------- |
| Code checks (format, lint, types, build)  | Verified locally, all passing                                             |
| Unit tests                                | 131 passing (ai-engine 46, knowledge 10, web 23, others 52)               |
| Integration tests (real PostgreSQL)       | 89 passing (knowledge 21, web 61, worker 7)                               |
| Prisma schema and migrations              | Valid; new migration applied to the local dev DB; no drift                |
| Dependency audit (`pnpm audit --prod`)    | No known vulnerabilities                                                  |
| Secret scan (gitleaks 8.30.1)             | No leaks in full history or staged changes                                |
| Real model availability (`pnpm ai:check`) | **PENDING (needs `GEMINI_API_KEY`)**                                      |
| Model evaluation (`pnpm ai:eval`)         | **PENDING (needs `GEMINI_API_KEY`)**                                      |
| Real knowledge-base test (`ai:kb-test`)   | **PENDING (needs `GEMINI_API_KEY`)**                                      |
| Automatic WhatsApp replies                | Disabled (`AI_AUTO_REPLY_ENABLED=false`); nothing is sent from Phase 3 UI |

## 2. Model verification and evaluation (real API: PENDING)

Run when the key is configured (synthetic data only; the eval costs a few cents):

```sh
pnpm ai:check
pnpm ai:eval -- --models gemini-3.1-flash-lite,gemini-3.5-flash-lite --yes
```

`ai:check` lists the models the key can access, confirms that the chat model supports
`generateContent`, that `gemini-embedding-2` supports `embedContent`, and that it returns
768-dimension vectors, then runs one synthetic embedding and one synthetic chat call.

`ai:eval` runs 20 synthetic cases per model: 10 answerable (English, Roman Urdu and Urdu) and 10
that must hand off (unknown product, stock level, invented discount, prompt injection in English and
Urdu, off-topic, request for a person, and more). It reports **safety and quality separately**:

- **Safety:** unsafe replies (an answer where a handoff was required, or an answer that states an
  unsupported number or link), correct handoffs, and invented drafts caught by the grounding check.
- **Quality:** correct answers, over-cautious handoffs on answerable questions, and language
  fidelity (Roman Urdu answered in Latin script, Urdu in Urdu script).
- **Performance:** p50 and p95 latency, tokens, and estimated cost.

A JSON report is written to `.data/eval/` (git-ignored).

| Metric                         | gemini-3.1-flash-lite | gemini-3.5-flash-lite |
| ------------------------------ | --------------------- | --------------------- |
| Model available (`ai:check`)   | PENDING               | PENDING               |
| Unsafe replies (lower = safer) | PENDING               | PENDING               |
| Correct handoffs (of 10)       | PENDING               | PENDING               |
| Correct answers (of 10)        | PENDING               | PENDING               |
| Over-cautious handoffs         | PENDING               | PENDING               |
| Roman Urdu / Urdu script kept  | PENDING               | PENDING               |
| Latency p50 / p95              | PENDING               | PENDING               |
| Cost for 20 cases              | PENDING               | PENDING               |

Published list prices (checked on ai.google.dev on 2026-10-19, USD per 1M tokens):

| Model                   | Input | Output | Notes                       |
| ----------------------- | ----- | ------ | --------------------------- |
| `gemini-3.1-flash-lite` | 0.25  | 1.50   | Current default             |
| `gemini-3.5-flash-lite` | 0.30  | 2.50   | Candidate                   |
| `gemini-embedding-2`    | 0.20  | —      | Text input; 768 dims stored |

## 3. Knowledge-base integration test (real API: PENDING)

`pnpm ai:kb-test` (`apps/web/scripts/kb-integration.ts`) runs against the local development
database only (it refuses any non-localhost `DATABASE_URL`) and uses fictional data only. It:

- creates **two new** fictional organizations with a password-less owner each, and never modifies
  or deletes existing records;
- adds a fictional FAQ (pasted, English and Roman Urdu), a product list (Markdown upload), a policy
  document (PDF upload, extracted on the server), an Urdu document, and a different catalog for the
  second organization;
- indexes everything through real Gemini embeddings and checks `vector_dims = 768` and the stored
  model;
- checks retrieval, the playground, cited sources, and answers in English, Roman Urdu and Urdu;
- checks handoff for missing information and stock levels, cross-organization isolation (in
  retrieval and in answers), approve and reject review, that no WhatsApp job or outbound message was
  created, that the per-organization budget blocks calls, and that every call was metered.

| Check                                                    | Result  |
| -------------------------------------------------------- | ------- |
| Vectors stored at 768 dimensions with model recorded     | PENDING |
| Retrieval finds the right fictional document             | PENDING |
| English / Roman Urdu / Urdu answers grounded and cited   | PENDING |
| Handoff when the knowledge base lacks the answer         | PENDING |
| Organization A never sees organization B's knowledge     | PENDING |
| Budget set to 0 blocks further calls                     | PENDING |
| No WhatsApp job or outbound message created              | PENDING |
| Every call recorded with model, tokens, cost and latency | PENDING |

The same behaviours are already covered offline by the integration suites (fake embeddings and a
scripted chat model against real PostgreSQL with pgvector). Those tests prove the pipeline,
isolation and budget logic, **not** Gemini's answer quality.

## 4. Phase 3 audit

| #   | Area                         | Finding                                                                                                                             | Resolution                                                                                                                                                                                                | Evidence                                                    |
| --- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 1   | Embedding batching           | With `gemini-embedding-2`, the SDK merges a `string[]` into **one** embedding, so batched chunks would all receive the same vector. | Each text is sent as its own `Content` (`[{ parts: [{ text }] }]`).                                                                                                                                       | SDK contract test (real SDK, local mock server)             |
| 2   | Timeouts and retries         | The SDK has no timeout and no retries by default; a hung call could block a request indefinitely.                                   | 30 s timeout (`GEMINI_TIMEOUT_MS`); up to 3 attempts (`GEMINI_MAX_ATTEMPTS`, max 5) only on 408, 429 and 5xx, with exponential backoff and jitter. Timeouts show "try again" in the UI.                   | SDK contract test; unit tests                               |
| 3   | Concurrent budget safety     | The budget was checked and then spent in separate steps, so parallel requests could all pass the check and overspend.               | Per-organization `pg_advisory_xact_lock`; an upper-bound cost is reserved in `AiBudgetReservation` before each call and released afterwards (also on failure). Reservations count toward spend.           | Integration test: 4 parallel requests, 1 allowed, 3 refused |
| 4   | Token and cost accounting    | Character-based token estimates under-counted Urdu, so the pre-call reservation could be too small.                                 | Estimates use UTF-8 bytes / 4 (an upper bound for Urdu). Actual cost is recorded from the provider's usage metadata, including thinking tokens. Unknown model prices are refused.                         | Unit tests                                                  |
| 5   | Unsupported numerical claims | Single-digit numbers ("3 days", "5 in stock") were not checked against the sources.                                                 | Every number, including single digits and Urdu digits, and every URL must appear in the sources or the customer's text, otherwise the draft is withheld and the conversation is handed off.               | Unit tests                                                  |
| 6   | Document ingestion security  | PDF parsing had no page or time limit.                                                                                              | Max 200 pages and a 20 s extraction timeout; font loading and XFA disabled; parser resources always released. The existing limits (5 MB, type by signature, server-side extraction) are unchanged.        | Unit tests                                                  |
| 7   | Sensitive information        | Documents could contain card numbers or credentials that would then be sent to the model and shown in answers.                      | Content is scanned at ingest: Luhn-valid card numbers and credentials (API keys, private keys, passwords) are refused; national ID numbers produce a warning. Findings never include the value.           | Unit and integration tests                                  |
| 8   | Prompt injection             | Instructions hidden in documents or customer messages could try to change the assistant's behaviour.                                | Sources are delimited as data, customer text appears only in user turns, output is structured JSON, and the grounding check applies. Instruction-like document text produces a warning at ingest.         | Unit tests; English and Urdu injection cases in `ai:eval`   |
| 9   | Embedding consistency        | Mixing vectors from different models or dimensions would make similarity scores meaningless.                                        | Dimensions are validated at startup against the 768-dimension column; retrieval only uses chunks whose `embeddingModel` matches the configured model; the query and documents use matching task prefixes. | Unit and integration tests                                  |
| 10  | Tenant-isolated retrieval    | No issue found.                                                                                                                     | SQL filters on `organizationId` for both the chunk and its document; other tenants' document and suggestion IDs return not-found.                                                                         | Integration tests (manipulated IDs)                         |
| 11  | API error handling           | No issue found after fixes 2 and 3.                                                                                                 | Errors are mapped to codes (`timeout`, `http_429`, …) and stored without prompt or error text; refusals and invalid output become a handoff; reservations are released on failure.                        | Integration tests                                           |
| 12  | Approval and rejection       | No issue found.                                                                                                                     | Admins and owners can approve or reject with a rating and notes; reviews are organization-scoped and never queue or send a WhatsApp message.                                                              | Integration tests                                           |

## 5. Known limitations

- The grounding check covers numbers and links, not every factual statement. Wording about a policy
  can still be wrong, so human review in draft mode is required before automatic replies.
- Prompt-injection text in documents produces a warning only; it is not blocked, because legitimate
  documents can contain similar wording.
- Changing the embedding model leaves older chunks unused until the documents are re-indexed. The UI
  does not yet flag documents that need re-indexing.
- If a process crashes mid-call, its budget reservation is held until it expires (15 minutes).
- Scanned PDFs (images without text) are not supported; there is no OCR.
- `AI_RETRIEVAL_MIN_SIMILARITY` (0.55) is a starting value and must be tuned with real embeddings.
- The local cluster runs PostgreSQL 18.4; CI uses PostgreSQL 16 with pgvector 0.8.7.

## 6. Remaining credentials and steps

- `GEMINI_API_KEY` (paid tier for business data) in the local `.env`, then run `pnpm ai:check`,
  `pnpm ai:eval -- --models gemini-3.1-flash-lite,gemini-3.5-flash-lite --yes` and
  `pnpm ai:kb-test`, and fill in sections 2 and 3.
- Pull request: create a **draft** PR from `feat/phase-3-gemini-rag` to `main` (the GitHub CLI is
  not authenticated on this machine).
- WhatsApp Cloud API credentials remain out of scope; automatic replies stay disabled.

## 7. Recommended model configuration

Provisional, until the evaluation in section 2 has been run:

```sh
GEMINI_CHAT_MODEL="gemini-3.1-flash-lite"   # cheapest of the two candidates; confirm with ai:eval
GEMINI_EMBEDDING_MODEL="gemini-embedding-2"
GEMINI_EMBEDDING_DIMENSIONS="768"
GEMINI_THINKING_LEVEL="minimal"
GEMINI_TIMEOUT_MS="30000"
GEMINI_MAX_ATTEMPTS="3"
AI_RETRIEVAL_MIN_SIMILARITY="0.55"
AI_AUTO_REPLY_ENABLED="false"
```

Selection rule for the final choice: prefer the model with **zero unsafe replies**; among those,
the one with the most correct answers and the best script fidelity in Urdu and Roman Urdu; use cost
and latency only as a tie-breaker.
