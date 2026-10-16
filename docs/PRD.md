# Ravi AI — Product Requirements Document

**Owner:** Ravi Stack
**Status:** Draft v0.1 (Phase 1)
**Last updated:** 2026-10-16

## 1. Summary

Ravi AI is a WhatsApp-first customer-support and sales-automation platform. Businesses connect
their WhatsApp Business number through the **official Meta WhatsApp Cloud API**, load a knowledge
base about their products and policies, and let an AI assistant answer customer questions, capture
leads, and hand conversations to human agents when needed.

Ravi AI is a standalone product. It is not part of, and shares no code, database, or deployment
with, the Ravi Stack agency website.

## 2. Problem

Small and mid-sized businesses receive most customer enquiries on WhatsApp. Replies are slow
outside business hours, answers are inconsistent between staff, and sales leads get lost in chat
history. Existing tools are either generic chatbots that invent answers or unofficial WhatsApp
automations that put the business number at risk of being banned.

## 3. Goals

1. Reply to inbound WhatsApp messages quickly and accurately, **grounded only in the business's own
   knowledge base**.
2. Hand off to a human whenever the assistant is not confident, the customer asks for a person, or
   the topic is out of scope.
3. Capture and track sales leads from conversations.
4. Give the business a dashboard to see conversations, contacts, leads and knowledge documents.
5. Support many businesses (tenants) on one deployment with strict data isolation.

## 4. Non-goals (for now)

- Subscription billing, plans and payments (explicitly deferred).
- Unofficial WhatsApp clients, WhatsApp Web scraping, or any automation outside Meta's official
  Cloud API and policies.
- Outbound marketing broadcasts. Business-initiated messages outside the 24-hour customer service
  window require approved templates and opt-in. This is a later phase with explicit compliance
  review.
- Voice and video calls.
- Integration with the Ravi Stack agency website.

## 5. Users and roles

| Role   | Description                                 | Key permissions                                                 |
| ------ | ------------------------------------------- | --------------------------------------------------------------- |
| Owner  | Business owner who created the organization | Everything, including member management and WhatsApp connection |
| Admin  | Trusted manager                             | Manage settings, knowledge base, members (except owners)        |
| Agent  | Support or sales staff                      | Read and reply to conversations, manage contacts and leads      |
| Viewer | Read-only stakeholder                       | View dashboards, conversations and leads                        |

A user can belong to several organizations with a different role in each.

## 6. Core user journeys

1. **Connect WhatsApp.** The owner registers their Cloud API phone number (phone number ID, WABA ID
   and an access token, stored encrypted). Meta delivers webhooks to Ravi AI.
2. **Build the knowledge base.** An admin adds documents (FAQs, policies, product information). The
   documents are chunked and indexed for retrieval.
3. **Customer asks a question.** The webhook is verified and stored durably. The worker records the
   contact, conversation and message. If AI auto-reply is enabled for the organization and the
   conversation, the assistant drafts a reply from retrieved knowledge and sends it.
4. **Escalation.** When no relevant knowledge exists, or the customer asks for a human, the
   conversation is marked _Pending_. The assistant does not guess.
5. **Agent takeover.** An agent opens the conversation in the dashboard, disables AI for that
   conversation, and replies manually.
6. **Lead capture.** An agent (and later the AI, with confirmation) creates a lead linked to the
   contact and tracks it through New → Contacted → Qualified → Won/Lost.

## 7. Functional requirements

### Phase 1 (this phase)

- Monorepo scaffold: dashboard app, background worker, shared packages.
- PostgreSQL schema for organizations, users, memberships, WhatsApp accounts, contacts,
  conversations, messages, leads, knowledge documents and chunks, jobs and audit logs.
- WhatsApp webhook endpoint with subscription verification (GET), HMAC-SHA256 signature
  verification (POST) and durable, idempotent ingestion into a job queue.
- Worker that processes inbound messages and delivery statuses into the data model.
- Pluggable LLM provider interface, an Anthropic provider adapter, and RAG building blocks
  (chunking, retrieval interface, grounded prompt). AI auto-reply is **off by default**.
- Responsive dashboard shell with navigation for all core areas.
- Role and permission model in code.

### Later phases

See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md): authentication, a live inbox, a knowledge
base UI, embeddings with pgvector, lead pipeline, analytics, templates, and onboarding through
Meta Embedded Signup.

## 8. Non-functional requirements

- **Security:** webhook signatures verified with constant-time comparison; secrets only on the
  server; access tokens encrypted at rest (AES-256-GCM); tenant scoping on every query; audit log
  for sensitive actions.
- **Reliability:** webhooks acknowledged only after being stored; at-least-once processing with
  idempotent handlers; retries with exponential backoff; dead-lettering after a set number of
  attempts.
- **Compliance:** official Cloud API only; respect the 24-hour customer service window; honour
  opt-outs; never send AI replies to contacts who have opted out.
- **Data integrity:** no destructive migrations without explicit approval; no seeded or fabricated
  customer data.
- **Maintainability:** strict TypeScript, shared validation schemas, automated tests for
  security-critical code paths.

## 9. AI behaviour principles

1. Answer only from the business's knowledge base and the conversation itself.
2. Never invent prices, stock levels, policies, delivery dates, or contact details.
3. When unsure, say a team member will follow up, and flag the conversation for a human.
4. Keep replies short and suited to WhatsApp.
5. Never request passwords, card numbers, or other sensitive credentials.

## 10. Success metrics (to instrument later)

- Median first-response time for inbound messages.
- Share of conversations resolved without human handoff, and the handoff rate.
- Leads captured per week, and lead-to-won conversion.
- Rate of AI replies flagged as incorrect by agents (target: trending to zero).

## 11. Open questions

- Which authentication approach should we use: self-hosted email and password, magic link, or
  OAuth? The decision is due in Phase 2.
- Should onboarding go through Meta Embedded Signup (Tech Provider) or manual token entry? This
  affects the Meta App Review timeline.
- What are the data retention requirements per tenant for message history?
