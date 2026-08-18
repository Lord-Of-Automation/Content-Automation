# Content Automation Console

A small web front end for the n8n "Content Automation" workflow: start a run,
watch it move through the pipeline, and read what it produced. Built for a team
that shares one password, deployed on Vercel.

It stores nothing of its own. Every run, status and log is read live from n8n's
own execution history, so there is no database to run and nothing to keep in
sync.

## Setup

**1. Import the workflow.** Load `Content_Automation_v36.json` into n8n. It adds
two nodes beside the existing form trigger: a webhook called **Web dashboard
trigger** and **Normalise webhook input**, which turns the webhook body into the
same shape the form produces. The old form still works exactly as before.

**2. Set the shared token.** Open **Normalise webhook input** and replace the
`TOKEN` value at the top with your own random string. Without it, anyone who
finds the webhook URL can start runs that publish to your live sites.

**3. Activate the workflow** so the production webhook URL responds.

**4. Create an n8n API key.** Settings > n8n API > Create an API key. The console
uses it only to read executions.

**5. Deploy.** Push this folder to a Git repo, import it in Vercel, and set the
environment variables below. No build settings to change.

## Environment variables

| Variable | What it is |
|---|---|
| `N8N_BASE_URL` | Your n8n URL, no trailing slash |
| `N8N_API_KEY` | From Settings > n8n API |
| `N8N_WORKFLOW_ID` | In the workflow's URL when you open it in n8n |
| `N8N_WEBHOOK_URL` | `https://your-n8n/webhook/content-automation` |
| `N8N_TRIGGER_TOKEN` | Must match `TOKEN` in the Normalise webhook input node |
| `CONSOLE_PASSWORD` | One password for the team |

All of them are server-side only. None reaches the browser: the API key and the
trigger token are used inside API routes, and the browser only ever talks to
this app.

## Running locally

```
npm install
cp .env.example .env.local     # then fill it in
npm run dev
```

Leaving `CONSOLE_PASSWORD` unset skips the password screen, which is convenient
locally and unsafe anywhere else.

## How the pipeline strip works

The five segments on a run page are the real stages of your workflow, matched by
node name in `lib/n8n.js`. A stage turns green when one of its nodes has run, red
when one of them failed. **If you rename a node in n8n, add the new name to
`STAGES` or that stage will always read as pending.**

The "What the run produced" panel surfaces the workflow's own diagnostic fields:
`gallery_note`, `gallery_image_count`, `demo_note`, `draft_words`, `parse_error`,
`stop_reason`, the page slug and the published link. Those are the fields that
say *why* a gallery or a demo is missing, which is usually the question.

## Known limits

- **The board shows runs, not a queue.** n8n decides execution order; this reads
  its history. There is no way to reorder or pause from here.
- **A brand new run takes a few seconds to appear**, because n8n only lists an
  execution once it has been recorded.
- **One workflow.** `N8N_WORKFLOW_ID` pins it to Content Automation. Supporting
  several would mean a workflow picker and per-workflow stage maps.
- **The password is a single shared secret in a cookie.** It keeps strangers
  out; it does not tell you who started which run. If you later need that, this
  is where real accounts would go.
