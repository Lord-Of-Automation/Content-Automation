# Content Automation — web console

A small Next.js front end for the **Content Automation** n8n workflow. It lets
you start a run from a browser, watch it move through the workflow stage by
stage, and see the history of previous runs — without opening n8n.

Built to deploy on Vercel.

---

## What it does

- **Guided run form.** URL, market, language, crawl limit, brief doc. The market
  list is generated from the workflow's own `location_code` lookup, so you cannot
  submit a market that n8n would silently fall back to the US on. The crawl
  slider stops at 10 because `Init crawl` clamps it there anyway.
- **Live progress.** The workflow reports nothing about itself, so the console
  reads the execution's `runData` from the n8n API and maps executed node names
  onto 16 ordered stages, from *Crawling the site* through to *Logging and
  indexing*. Branches the page did not take (game research on a casino page, the
  operator site visit on a game page) show as **not needed** rather than pending.
- **Run history.** Straight from the n8n execution log, with status and duration.
- **Email + password login.** Runs cost DataForSEO, Anthropic and Gemini credits,
  so nothing is public.

Your n8n API key and the trigger URL stay server-side. The browser only ever
talks to this app's own `/api` routes.

---

## Why runs are tracked, not awaited

One run is a DataForSEO crawl with a polling wait, two SERP queries, five or more
Claude calls at 300–600s timeouts, Gemini image generation, and a WordPress
publish. Five to twenty minutes is normal. No serverless function can hold a
request open that long, so the flow is:

```
browser → /api/runs (POST) → n8n trigger → returns execution id in ms
browser → /api/runs/:id  every 4s → n8n executions API → derived progress
```

---

## Setup

### 1. Patch the workflow (recommended)

See [`n8n-patch/README.md`](./n8n-patch/README.md). It adds a Webhook entry point
next to the existing Form Trigger — three pasted nodes, one connection, and a
three-line edit to `Init crawl`. The form keeps working.

Without it the console still runs, but a Form Trigger never returns an execution
id, so runs are matched by start time and two runs fired within seconds of each
other can be confused. Set `N8N_TRIGGER_MODE=form` if you want to skip the patch.

### 2. Get an n8n API key

n8n → **Settings → n8n API → Create an API key**. Available on self-hosted and on
n8n Cloud.

### 3. Configure environment

```bash
cp .env.example .env.local
```

Fill in every value. Two need generating:

```bash
# AUTH_SECRET
openssl rand -base64 32

# a password hash for AUTH_USERS
npm install
npm run hash -- "a long password"
```

`AUTH_USERS` is a one-line JSON array. Add as many people as you need:

```json
[
  {"email":"you@example.com","name":"You","passwordHash":"$2a$12$..."},
  {"email":"colleague@example.com","name":"Colleague","passwordHash":"$2a$12$..."}
]
```

### 4. Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000.

---

## Deploying to Vercel

1. Push this folder to a Git repo.
2. Import it in Vercel. Framework preset **Next.js**, no build settings to change.
3. Add every variable from `.env.example` under **Settings → Environment
   Variables**, for Production *and* Preview.
4. Deploy.

Two things to check afterwards:

- **`AUTH_SECRET` must be set in Vercel.** Auth.js will not issue sessions
  without it and every sign-in will fail.
- **Your n8n instance must be reachable from Vercel.** If it sits behind a VPN,
  an IP allowlist or Cloudflare Access, the API calls will fail. Allowlist
  Vercel's egress or put n8n behind a public hostname with the API key as the
  only gate.

---

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `AUTH_SECRET` | yes | Signs session cookies. Any random 32+ char string. |
| `AUTH_USERS` | yes | JSON array of `{email, name, passwordHash}`. |
| `N8N_BASE_URL` | yes | Origin of your n8n instance, no trailing slash. |
| `N8N_API_KEY` | yes | Sent as `X-N8N-API-KEY` when reading executions. |
| `N8N_WORKFLOW_ID` | no | Defaults to `rK5Va4IFiHgasLWp`. |
| `N8N_TRIGGER_MODE` | no | `webhook` (default) or `form`. |
| `N8N_TRIGGER_URL` | yes | Full URL of the webhook or form trigger. |
| `N8N_WEBHOOK_SECRET` | no | Sent as `x-trigger-secret` in webhook mode. |

---

## Layout

```
app/
  actions.ts              sign in / sign out server actions
  login/page.tsx          sign-in screen
  runs/page.tsx           the console
  api/runs/route.ts       POST start a run · GET list executions
  api/runs/[id]/route.ts  GET one execution with derived progress
  api/runs/resolve/       POST match a run by start time (form mode fallback)
components/
  Console.tsx             state, polling, orchestration
  RunForm.tsx             the guided form
  RunProgress.tsx         stage list and progress bar
lib/
  n8n.ts                  n8n trigger + executions API client
  progress.ts             node name → stage mapping
  markets.ts              market and language options
  validate.ts             input validation
n8n-patch/                the optional workflow patch
```

---

## Maintenance note

`lib/progress.ts` matches n8n node names as literal strings. **If you rename a
node in the workflow, rename it there too**, otherwise that stage silently never
lights up. Everything else keeps working — a missing name only costs you the
progress detail for that stage.

## Known limits

- Progress needs `includeData=true`, which returns the whole run payload. On this
  workflow that can be several megabytes because base64 screenshots travel with
  it, and n8n occasionally refuses to serialise it at all. When that happens the
  console keeps showing the correct status and says progress is unavailable for
  that run, rather than failing.
- The console shows workflow-level status. Per-page outcomes for a whole-site run
  land in the Published and Log sheets, which this app does not read.
