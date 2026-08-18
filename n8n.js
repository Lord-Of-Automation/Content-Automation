// Everything that talks to n8n lives here, and it only ever runs on the server:
// the API key and the trigger token must never reach the browser.

const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');

export function configured() {
  return Boolean(BASE && process.env.N8N_API_KEY && process.env.N8N_WORKFLOW_ID);
}

async function api(path, init = {}) {
  const res = await fetch(BASE + '/api/v1' + path, {
    ...init,
    headers: { 'X-N8N-API-KEY': process.env.N8N_API_KEY || '', accept: 'application/json', ...(init.headers || {}) },
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error('n8n responded ' + res.status + (body ? ': ' + body.slice(0, 300) : ''));
  }
  return res.json();
}

// n8n reports a finished-but-failed run as status "error", and a run that is
// still going has no stoppedAt. Collapse both into one word the UI can style.
function state(execution) {
  if (!execution.finished && !execution.stoppedAt) return 'running';
  if (execution.status === 'error' || execution.status === 'crashed') return 'failed';
  if (execution.status === 'waiting') return 'waiting';
  if (execution.status === 'canceled') return 'stopped';
  return execution.finished ? 'done' : 'running';
}

function summarise(execution) {
  return {
    id: String(execution.id),
    state: state(execution),
    startedAt: execution.startedAt || null,
    stoppedAt: execution.stoppedAt || null,
    mode: execution.mode || null,
  };
}

export async function listRuns(limit = 25) {
  const q = new URLSearchParams({ workflowId: process.env.N8N_WORKFLOW_ID || '', limit: String(limit) });
  const data = await api('/executions?' + q.toString());
  return (data.data || []).map(summarise);
}

// The stages a page actually goes through. Each one is matched by the n8n node
// that does the work, so the strip in the UI reflects the real pipeline rather
// than a made-up percentage.
// Node names checked against the workflow export, not guessed. If you rename a
// node in n8n, add the new name here or its stage will read as pending.
export const STAGES = [
  { key: 'crawl',    label: 'Crawl',    nodes: ['OnPage: start crawl', 'OnPage: check status', 'OnPage: get pages'] },
  { key: 'research', label: 'Research', nodes: ['Find quick wins', 'Classify page type', 'Match SlotsLaunch game'] },
  { key: 'draft',    label: 'Draft',    nodes: ['Draft page', 'Draft game page (AI)', 'Parse draft'] },
  { key: 'media',    label: 'Media',    nodes: ['Insert game demo', 'Insert image gallery', 'Upload gallery image'] },
  { key: 'publish',  label: 'Publish',  nodes: ['Build meta', 'Validate meta', 'WP: update in place', 'Log to Published', 'IndexNow ping'] },
];

// Fields the workflow writes for its own diagnostics. Surfacing them is the
// whole point of the run page: they say why a gallery or a demo is missing.
const DIAGNOSTIC_KEYS = [
  'gallery_note', 'gallery_embedded', 'gallery_image_count',
  'demo_note', 'demo_embedded', 'parse_error', 'stop_reason', 'draft_words',
];

export async function getRun(id) {
  const execution = await api('/executions/' + encodeURIComponent(id) + '?includeData=true');
  const runData = (execution.data && execution.data.resultData && execution.data.resultData.runData) || {};
  const errorNode = execution.data && execution.data.resultData && execution.data.resultData.lastNodeExecuted;
  const error = execution.data && execution.data.resultData && execution.data.resultData.error;

  const nodes = Object.keys(runData).map((name) => {
    const runs = runData[name] || [];
    const first = runs[0] || {};
    const failed = runs.some((r) => r.error);
    return {
      name,
      failed,
      items: runs.reduce((n, r) => n + (((r.data || {}).main || [[]])[0] || []).length, 0),
      ms: runs.reduce((n, r) => n + (r.executionTime || 0), 0),
      startedAt: first.startTime ? new Date(first.startTime).toISOString() : null,
      error: failed ? String((runs.find((r) => r.error) || {}).error?.message || 'failed') : null,
    };
  }).sort((a, b) => (a.startedAt || '').localeCompare(b.startedAt || ''));

  const done = new Set(nodes.filter((n) => !n.failed).map((n) => n.name));
  const broken = new Set(nodes.filter((n) => n.failed).map((n) => n.name));
  const stages = STAGES.map((s) => ({
    key: s.key,
    label: s.label,
    state: s.nodes.some((n) => broken.has(n)) ? 'failed'
         : s.nodes.some((n) => done.has(n)) ? 'done'
         : 'pending',
  }));

  // Pull the workflow's own notes out of the last item that carries them.
  const diagnostics = {};
  for (const name of Object.keys(runData)) {
    for (const run of runData[name] || []) {
      const items = ((run.data || {}).main || [[]])[0] || [];
      for (const item of items) {
        for (const key of DIAGNOSTIC_KEYS) {
          if (item && item.json && item.json[key] !== undefined) diagnostics[key] = item.json[key];
        }
        if (item && item.json && item.json.page && item.json.page.slug) diagnostics.slug = item.json.page.slug;
        if (item && item.json && item.json.link) diagnostics.link = item.json.link;
      }
    }
  }

  return {
    ...summarise(execution),
    nodes,
    stages,
    diagnostics,
    error: error ? { node: errorNode || null, message: String(error.message || error) } : null,
  };
}

export async function startRun(payload) {
  const url = process.env.N8N_WEBHOOK_URL;
  if (!url) throw new Error('N8N_WEBHOOK_URL is not set');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Trigger-Token': process.env.N8N_TRIGGER_TOKEN || '' },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) throw new Error('n8n refused the run (' + res.status + ')' + (text ? ': ' + text.slice(0, 300) : ''));
  return { ok: true, response: text.slice(0, 500) };
}
