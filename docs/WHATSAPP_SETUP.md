# WhatsApp Cloud API setup and inbound test

How to connect a Meta WhatsApp Cloud API app (for example, the Ravi AI developer app with Meta's
test number) to a local Ravi AI, and how to test inbound messages safely. **Ravi AI does not send
WhatsApp messages in this setup:** automatic replies stay off (`AI_AUTO_REPLY_ENABLED=false`), and
AI draft mode only stores suggestions for review.

## 1. Configuration

All values go in the repository's `.env` (git-ignored). Each name must appear **only once**:
different tools resolve duplicates differently (`dotenv-cli` keeps the first value; Node and
Next.js keep the last).

| Variable                        | Secret?   | Where it comes from                                          | Used by                                                 |
| ------------------------------- | --------- | ------------------------------------------------------------ | ------------------------------------------------------- |
| `WHATSAPP_VERIFY_TOKEN`         | Yes       | A random string you choose (≥ 32 chars recommended)          | Webhook handshake (GET); same value entered in Meta     |
| `WHATSAPP_APP_SECRET`           | Yes       | Meta App Dashboard → App settings → Basic → App secret       | Verifies `X-Hub-Signature-256` on every webhook POST    |
| `WHATSAPP_ACCESS_TOKEN`         | Yes       | Meta App Dashboard → WhatsApp → API Setup (temporary, ~24 h) | `account:register` (stored encrypted), `whatsapp:check` |
| `ENCRYPTION_KEY`                | Yes       | `openssl rand -base64 32` (32 random bytes)                  | Encrypts stored access tokens (AES-256-GCM)             |
| `WHATSAPP_PHONE_NUMBER_ID`      | No        | WhatsApp → API Setup → Phone number ID                       | `account:register`, `whatsapp:check`, simulator         |
| `WHATSAPP_BUSINESS_ACCOUNT_ID`  | No        | WhatsApp → API Setup → WhatsApp Business Account ID          | `account:register`, `whatsapp:check`                    |
| `WHATSAPP_APP_ID`               | No        | App settings → Basic → App ID (optional)                     | `whatsapp:check` confirms your app receives webhooks    |
| `WHATSAPP_GRAPH_API_VERSION`    | No        | `v24.0` (available until 2028-02-18; latest is `v26.0`)      | Worker and diagnostics                                  |
| `AI_AUTO_REPLY_ENABLED`         | No        | Keep `false`                                                 | Global kill switch for automatic replies                |
| `AI_DRAFT_REPLIES_ENABLED`      | No        | `true` to have Gemini draft replies for review (never sent)  | Worker                                                  |
| `AI_PROVIDER`, `GEMINI_API_KEY` | Yes (key) | See the Gemini section of the README                         | Draft mode                                              |

Generate a verify token without OpenSSL:
`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

At runtime the web app and worker read the phone number, account ID and (encrypted) token from the
database, per organization; the `.env` IDs and token are only used by the CLI tools. Tokens never
reach browser code: no `NEXT_PUBLIC_` variable holds them and no dashboard query selects them.

## 2. Read-only connection check

```sh
pnpm whatsapp:check                       # token from WHATSAPP_ACCESS_TOKEN
pnpm whatsapp:check -- --token-source db  # token stored for the registered number
pnpm whatsapp:check -- --offline          # configuration and database only, no Meta calls
```

It reports whether each variable is set and well-formed (never its value), whether the number is
registered to an organization, and, with GET requests only, whether the token can read the phone
number and the WhatsApp Business Account, whether the number belongs to that account, its platform
(`CLOUD_API`) and quality rating, and which app is subscribed to the account's webhooks. It never
sends messages, subscribes apps, or writes to the database.

## 3. Webhook

- **Callback URL:** `https://<public-host>/api/webhooks/whatsapp`
- **Verify token:** the value of `WHATSAPP_VERIFY_TOKEN`
- **Webhook field to subscribe:** `messages`
- **Webhook version** (in the dashboard): `v24.0` or later

What the endpoint does:

| Concern        | Behaviour                                                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Handshake      | `GET` returns `hub.challenge` only for `hub.mode=subscribe` and a matching token (constant-time); otherwise 403. 503 if not configured.                            |
| Signature      | `POST` bodies are limited to 1 MB; HMAC-SHA256 over the exact raw bytes with the app secret, constant-time compare; invalid → 401, nothing stored.                 |
| Durability     | A valid event is stored as a job before replying 200; if the database is down the endpoint returns 500 so Meta retries.                                            |
| Idempotency    | Job dedupe key = SHA-256 of the raw body (redeliveries collapse); messages are unique per organization and `wamid`; statuses only move forward.                    |
| Tenant routing | The organization is found from `metadata.phone_number_id` → registered `WhatsAppAccount`. Unknown or disabled numbers are ignored; tenants are never auto-created. |
| Logging        | Logs contain IDs, counts and error codes, never message text, tokens or the app secret.                                                                            |

### Exposing the local webhook with a temporary HTTPS tunnel

Meta only calls HTTPS URLs with a valid certificate. For a short test, a Cloudflare quick tunnel
needs no account:

```sh
winget install --id Cloudflare.cloudflared   # once
pnpm dev                                     # web on http://localhost:3000 and the worker
cloudflared tunnel --url http://localhost:3000
```

It prints a random `https://<words>.trycloudflare.com` URL; the callback URL is that host plus
`/api/webhooks/whatsapp`. Precautions:

- The tunnel exposes the **whole** web app, not only the webhook. Sign-up is closed and every page
  requires a session, but run the tunnel only while testing and stop it (Ctrl+C) afterwards.
- `next dev` shows detailed error pages. Don't share the URL, and don't leave it running.
- Keep using `http://localhost:3000` for the dashboard; sign-in through the tunnel host is not
  configured (`BETTER_AUTH_URL` is localhost).
- A quick tunnel gets a new URL every time, so update the callback URL in Meta each time.
- For longer use, a named Cloudflare tunnel can restrict traffic to the webhook path:

  ```yaml
  ingress:
    - hostname: webhook.example.com
      path: ^/api/webhooks/whatsapp$
      service: http://localhost:3000
    - service: http_status:404
  ```

## 4. Inbound test plan (Meta test number)

Prerequisites: `.env` without duplicate keys; `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`,
`WHATSAPP_ACCESS_TOKEN`, `ENCRYPTION_KEY` and both IDs set; `pnpm db:local` running.

1. `pnpm whatsapp:check`: all checks pass (the subscription check may warn until step 6).
2. Register the test number to an organization (stores the token encrypted; creates the
   organization only if the slug does not exist; never moves a number between organizations):
   `pnpm --filter @ravi/db account:register --org-slug <your-org-slug> --org-name "<Your org>"`
3. Optional AI drafts: set `AI_PROVIDER=gemini` and `AI_DRAFT_REPLIES_ENABLED=true`; the owner
   enables AI data processing under **Settings**; add and index fictional knowledge.
4. **Local dry run, no Meta involved:** with `pnpm dev` running,
   `pnpm whatsapp:simulate -- --text "Lahore mein delivery kitne din mein hogi?"`
   posts a correctly signed fictional event to localhost. Check **Conversations** (a message from
   +1 555 000 0199) and, with draft mode on, the **AI drafts** card. Re-send with `--repeat-id` to
   confirm duplicates are ignored.
5. Start the tunnel (section 3). In Meta App Dashboard → WhatsApp → Configuration, enter the
   callback URL and verify token and click **Verify and save** (the web log shows
   `webhook verification succeeded`). Subscribe to the **messages** field.
6. `pnpm whatsapp:check` again (with `WHATSAPP_APP_ID` set): your app is listed as subscribed.
7. From your own WhatsApp, send a short **fictional** message to the test number (add your number
   under API Setup → "To" first if Meta requires it). Expected: web log `POST 200`; worker log
   `inbound message stored`; the conversation appears under the registered organization; with
   draft mode on, a draft appears within a few seconds. **Nothing is sent back.**
8. Stop the tunnel. The temporary token expires after about 24 hours; for longer tests use a
   System User token and re-register with `--rotate-token`.

Not part of this test (needs separate approval): sending any message, including Meta's "Send
message" button in API Setup, and enabling automatic replies.

## 5. AI drafts

With `AI_DRAFT_REPLIES_ENABLED=true`, each inbound text message (in a conversation with AI enabled,
from a contact who has not opted out) queues a draft job. Gemini answers from the organization's
knowledge base with the same grounding and handoff rules as the playground, under the same consent,
budget and hourly limits (usage is recorded as `DRAFT_REPLY`). The result is stored as an
`AiSuggestion` linked to the conversation and shown on the conversation page and in the AI
playground list for review. A draft job never creates an outbound message, never queues a send job
and never changes the conversation. Approving a draft is an evaluation signal only.
