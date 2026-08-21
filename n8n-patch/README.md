# Workflow patch — adding an API trigger

The workflow currently starts from a **Form Trigger**. You can point the console
straight at that (`N8N_TRIGGER_MODE=form`) and it will work, but with two real
drawbacks:

1. The Form Trigger never tells you which execution it created, so the console
   has to guess by start time. Fire two runs close together and it can latch
   onto the wrong one.
2. POSTing at a Form Trigger from code is not a documented n8n interface, and
   the production URL has had bugs
   ([n8n#19317](https://github.com/n8n-io/n8n/issues/19317)).

This patch adds a proper Webhook entry point alongside the form. The form keeps
working exactly as it does today — nothing is removed.

Three nodes go in, one existing node gets a three-line edit.

---

## 1. Paste the new nodes

Open the workflow in n8n, click anywhere on the canvas, and paste the contents
of [`webhook-trigger-nodes.json`](./webhook-trigger-nodes.json) (Ctrl+V / Cmd+V).
n8n reads node JSON off the clipboard and drops the nodes in wired together:

```
API trigger  →  Normalise API input  →  Return execution id
```

They will land just above the existing **On form submission** node.

## 2. Wire it into the workflow

Drag one connection:

**`Return execution id`** → **`OnPage: start crawl`**

That is the only wiring change. `Return execution id` answers the HTTP request
immediately and then lets the run carry on, so the console gets the execution id
in milliseconds while the workflow keeps going for the next 5 to 20 minutes.

## 3. Patch the `Init crawl` node

`Init crawl` currently reads the form node by name, which throws when the run
came in through the webhook instead. Open **`Init crawl`** and replace the first
line:

```js
const form = $('On form submission').first().json;
```

with:

```js
// Either trigger can start this run, so read whichever one actually fired.
const form = (() => {
  try { return $('On form submission').first().json; } catch (e) {}
  try { return $('Normalise API input').first().json; } catch (e) {}
  return {};
})();
```

Leave the rest of the node alone.

## 4. Activate and copy the URL

Save, then **activate** the workflow — a webhook only listens on its production
URL while the workflow is active.

Copy the production URL from the **API trigger** node. It looks like:

```
https://your-n8n-instance.example.com/webhook/content-automation/run
```

Put that in `N8N_TRIGGER_URL` and set `N8N_TRIGGER_MODE=webhook`.

## 5. Optional: lock the webhook down

The webhook URL is unauthenticated by default, and anyone who has it can spend
your DataForSEO, Anthropic and Gemini credits. To require a shared secret:

1. In **`Normalise API input`**, set `EXPECTED_SECRET` to a long random string.
2. Set the same value as `N8N_WEBHOOK_SECRET` in Vercel.

The console sends it as the `x-trigger-secret` header, and the node throws
without it.

---

## Verifying

```bash
curl -X POST https://your-n8n-instance.example.com/webhook/content-automation/run \
  -H 'content-type: application/json' \
  -d '{"website_url":"https://example.com/some-page/","market":"gb","language":"en","max_crawl_pages":10,"brief_doc_id":"1TesrkPHHJRHq0Gmb6keRrY-TdrWJ_u3QDFwNWOpwR6s"}'
```

You should get back, within a second or so:

```json
{ "executionId": "1234", "startedAt": "2026-08-21T10:04:11.000Z" }
```

If you get `{"message":"Workflow was started"}` instead, the `Return execution
id` node is not connected to the trigger, or the Webhook node's **Respond**
setting is not `Using Respond to Webhook node`.
