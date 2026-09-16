"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useAsk } from "@/components/Ask";
import PageTypeEditor, { type EditorOrigin } from "@/components/PageTypeEditor";
import RunProgress from "@/components/RunProgress";
import { Select } from "@/components/Select";
import StatusBadge from "@/components/StatusBadge";
import { Toasts, useToasts } from "@/components/Toasts";
import { formatWhen } from "@/lib/format";
import { LANGUAGES, MARKETS, MARKET_DEFAULT_LANGUAGE } from "@/lib/markets";
import {
  BLOCK_LABELS,
  POKER_EXAMPLE,
  type CustomAction,
  type CustomRun,
  type DesignDraft,
  type PageType,
} from "@/lib/pagetypeshape";
import type { ExecutionDetail, N8nStatus } from "@/lib/n8n";

/**
 * Pages of a kind the engine was never written for.
 *
 * The engine knows four kinds of page by name, and each has its own research,
 * prompt and sections built into it. Anything else — a poker player, a
 * software provider, a tournament — meant changing the engine. A page type
 * says the same things as data, so a new kind of page is a form filled in here
 * rather than a deploy.
 *
 * Three tabs, for the three things somebody comes here to do: keep the types,
 * have the engine draft one from pages that already look right, and run one.
 * The runs sit underneath all three, because whichever tab started a run, the
 * next thing anybody wants is to watch it.
 *
 * Kept apart from the Runs page on purpose. That page is the optimiser and has
 * years of habits built on it; nothing here changes what it does.
 */

type Tab = "types" | "design" | "run";

/** What the Run tab holds between visits. The example pages are not kept: they are one-off. */
interface Inputs {
  action: Exclude<CustomAction, "design">;
  pageTypeId: string;
  pageUrl: string;
  siteUrl: string;
  sourceUrl: string;
  publishNow: boolean;
  market: string;
  language: string;
}

const DEFAULT_INPUTS: Inputs = {
  action: "optimise",
  pageTypeId: "",
  pageUrl: "",
  siteUrl: "",
  sourceUrl: "",
  // A new page is a draft unless somebody says otherwise. Publishing a page
  // nobody has read is a choice, not a default.
  publishNow: false,
  market: "gb",
  language: "en",
};

/**
 * Where New page type starts: nothing filled in but one empty section and one
 * empty fact, since every type needs the first and nearly every type the second.
 */
const BLANK_TYPE: PageType = {
  id: "",
  name: "",
  description: "",
  subject: "",
  recognise: { urlPatterns: [], bodyClasses: [], examples: [] },
  facts: [{ key: "", label: "", hint: "", verify: true, schemaProperty: "" }],
  trustedSources: [],
  outline: [{ heading: "", guidance: "" }],
  rules: [],
  avoid: [],
  blocks: [],
  schemaType: "",
  wordpress: { postType: "", styleFrom: "" },
  words: 0,
  createdAt: "",
  updatedAt: "",
  updatedBy: "",
};

const INPUT_KEY = "ca:custom:last-input";
const SELECTED_KEY = "ca:custom:selected";
const DETAIL_POLL = 4_000;
const DRAFT_POLL = 4_000;
const LIST_POLL = 15_000;

const ACTION_WORDS: Record<CustomAction, string> = {
  optimise: "Optimise",
  add: "Add",
  design: "Draft",
};

// Local copy so the client bundle does not pull in the whole n8n module.
function isTerminal(status: N8nStatus | undefined): boolean {
  return (
    status === "success" ||
    status === "error" ||
    status === "crashed" ||
    status === "canceled"
  );
}

/** The engine's words for a run's state, in the console's. */
function statusOf(status: string): N8nStatus {
  switch (status) {
    case "queued":
      return "new";
    case "running":
    case "success":
    case "error":
    case "canceled":
    case "crashed":
      return status;
    default:
      return "unknown";
  }
}

/** An http or https address, or null. */
function webAddress(text: string): URL | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** The address without the parts that are the same on every row. */
function shortAddress(text: string): string {
  return text.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
}

function excerpt(text: string, most = 220): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > most ? `${flat.slice(0, most).trimEnd()}…` : flat;
}

/**
 * One run's detail, kept current while it is going.
 *
 * Used twice on this page — for the run picked in the list and for a design
 * run being followed on its tab — so the polling and the guard against
 * answers arriving out of order are written once. The guard matters because
 * somebody clicking through the list outruns the requests: without it the
 * answer for the run they left overwrites the one they are now reading.
 */
function useRunDetail(id: string | null, onGone: (id: string, message: string) => void) {
  const [detail, setDetail] = useState<ExecutionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wanted = useRef<string | null>(null);

  // Held in a ref so a caller passing a fresh function each render does not
  // restart the polling every time.
  const gone = useRef(onGone);
  gone.current = onGone;

  const load = useCallback(async (runId: string) => {
    wanted.current = runId;
    setLoading(true);
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}`, { cache: "no-store" });
      if (wanted.current !== runId) return;
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const payload = await response.json();
      if (wanted.current !== runId) return;

      if (response.status === 404) {
        setDetail(null);
        gone.current(runId, payload.error ?? "That run no longer exists.");
        return;
      }
      if (!response.ok) throw new Error(payload.error ?? "That run could not be read.");
      setDetail(payload.execution ?? null);
      setError(null);
    } catch (e) {
      if (wanted.current !== runId) return;
      setError(e instanceof Error ? e.message : "That run could not be read.");
    } finally {
      // Only the newest request may stop the spinner.
      if (wanted.current === runId) setLoading(false);
    }
  }, []);

  useEffect(() => {
    wanted.current = id;
    setDetail(null);
    setError(null);
    if (id) void load(id);
    else setLoading(false);
  }, [id, load]);

  // Polled only while the run can still change. Keyed on the status string
  // rather than the object, so a poll that changes nothing does not reset it.
  const current = detail && detail.id === id ? detail : null;
  const status = current?.status;
  useEffect(() => {
    if (!id || isTerminal(status)) return;
    const timer = window.setInterval(() => void load(id), DETAIL_POLL);
    return () => window.clearInterval(timer);
  }, [id, status, load]);

  return { detail: current, loading, error, reload: load };
}

export default function CustomView() {
  const ask = useAsk();
  const { toasts, push, dismiss } = useToasts();

  const [tab, setTab] = useState<Tab>("types");

  // ------------------------------------------------------------ page types
  const [pageTypes, setPageTypes] = useState<PageType[]>([]);
  /** Null until the engine has been asked. Nothing starts until it says yes. */
  const [engineReady, setEngineReady] = useState<boolean | null>(null);
  const [typesLoading, setTypesLoading] = useState(true);
  const [typesError, setTypesError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [editor, setEditor] = useState<{
    type: PageType;
    origin: EditorOrigin;
    /** A new sheet per opening, so a second draft does not inherit the first one's edits. */
    key: number;
  } | null>(null);
  // Read by the draft poll, which runs on its own clock and would otherwise
  // see whether a sheet was open when it started rather than now.
  const editorOpen = useRef(false);
  editorOpen.current = editor !== null;

  // ------------------------------------------------------------ inputs
  const [inputs, setInputs] = useState<Inputs>(DEFAULT_INPUTS);
  const [starting, setStarting] = useState(false);
  const [examples, setExamples] = useState("");
  const [designNote, setDesignNote] = useState("");

  // ------------------------------------------------------------ design run
  const [designRun, setDesignRun] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [designError, setDesignError] = useState<string | null>(null);
  /** A passing failure to ask, as opposed to the run failing. Asking carries on. */
  const [designHiccup, setDesignHiccup] = useState<string | null>(null);
  const [designDraft, setDesignDraft] = useState<PageType | null>(null);
  const [designSavedAs, setDesignSavedAs] = useState<string | null>(null);
  const [stoppingDesign, setStoppingDesign] = useState(false);

  // ------------------------------------------------------------ runs
  const [runs, setRuns] = useState<CustomRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [reopening, setReopening] = useState(false);

  const ready = engineReady === true;

  // ------------------------------------------------------------ loads

  const loadTypes = useCallback(async () => {
    try {
      const response = await fetch("/api/custom/types", { cache: "no-store" });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "The page types could not be read.");
      setPageTypes(payload.pageTypes ?? []);
      setEngineReady(payload.engineReady !== false);
      setTypesError(null);
    } catch (e) {
      setTypesError(e instanceof Error ? e.message : "The page types could not be read.");
    } finally {
      setTypesLoading(false);
    }
  }, []);

  const loadRuns = useCallback(async () => {
    try {
      const response = await fetch("/api/custom/runs", { cache: "no-store" });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "The runs could not be read.");
      setRuns(payload.runs ?? []);
      setRunsError(null);
    } catch (e) {
      setRunsError(e instanceof Error ? e.message : "The runs could not be read.");
    } finally {
      setRunsLoading(false);
    }
  }, []);

  const selectRun = useCallback((id: string | null) => {
    setSelected(id);
    try {
      if (id) window.localStorage.setItem(SELECTED_KEY, id);
      else window.localStorage.removeItem(SELECTED_KEY);
    } catch {
      /* private mode, cleared storage */
    }
  }, []);

  // A remembered run the engine no longer has. Forgotten rather than polled
  // forever.
  const forgetSelected = useCallback(
    (_id: string, message: string) => {
      selectRun(null);
      push("bad", message);
    },
    [push, selectRun],
  );

  const forgetDesign = useCallback((_id: string, message: string) => {
    setDesignError(message);
  }, []);

  const chosen = useRunDetail(selected, forgetSelected);
  // The same run in both places is asked about once.
  const followed = useRunDetail(designRun && designRun !== selected ? designRun : null, forgetDesign);
  const designDetail = designRun && designRun === selected ? chosen.detail : followed.detail;
  const designLoading = designRun && designRun === selected ? chosen.loading : followed.loading;

  // On arrival: the types, the runs, and whatever was being looked at last.
  useEffect(() => {
    void loadTypes();
    void loadRuns();

    try {
      const saved = window.localStorage.getItem(INPUT_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<Inputs>;
        setInputs((current) => ({ ...current, ...parsed }));
      }
      const picked = window.localStorage.getItem(SELECTED_KEY);
      if (picked) setSelected(picked);
    } catch {
      /* corrupt or unavailable storage is not worth surfacing */
    }
  }, [loadTypes, loadRuns]);

  /*
   * The list on a timer, since runs finish while nobody is clicking. The
   * engine check rides along while it is failing, so updating the engine is
   * noticed without a reload.
   */
  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadRuns();
      if (engineReady !== true) void loadTypes();
    }, LIST_POLL);
    return () => window.clearInterval(timer);
  }, [engineReady, loadRuns, loadTypes]);

  // ------------------------------------------------------------ editor

  const openEditor = useCallback((type: PageType, origin: EditorOrigin) => {
    setEditor({ type, origin, key: Date.now() });
  }, []);

  // A draft is always new. Whatever id the engine gave it, saving it must not
  // land on top of a type that happens to share it.
  const openDraft = useCallback(
    (draft: PageType) => openEditor({ ...draft, id: "" }, "draft"),
    [openEditor],
  );

  function saved(type: PageType, all: PageType[]) {
    const origin = editor?.origin;
    setPageTypes(all);
    setEditor(null);
    push("ok", `Saved ${type?.name ?? "the page type"}. Custom runs can use it now.`);
    if (origin === "draft") {
      setDesignDraft(null);
      setDesignSavedAs(type?.name ?? null);
      setTab("types");
    }
  }

  async function remove(type: PageType) {
    const sure = await ask.confirm({
      title: `Delete ${type.name}?`,
      body: (
        <>
          Pages already written with it stay as they are. Runs started after
          this cannot use it, and one left to detect its type will not find it.
        </>
      ),
      confirmLabel: "Delete it",
      tone: "danger",
    });
    if (!sure) return;

    setDeleting(type.id);
    try {
      const response = await fetch(`/api/custom/types?id=${encodeURIComponent(type.id)}`, {
        method: "DELETE",
      });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "It could not be deleted.");
      setPageTypes(payload.pageTypes ?? []);
      push("ok", `Deleted ${type.name}.`);
    } catch (e) {
      push("bad", e instanceof Error ? e.message : "It could not be deleted.");
    } finally {
      setDeleting(null);
    }
  }

  // ------------------------------------------------------------ inputs

  function setInput<K extends keyof Inputs>(key: K, value: Inputs[K]) {
    setInputs((current) => {
      const next = { ...current, [key]: value };
      // The language follows the market, until somebody picks one of their own.
      if (key === "market") {
        const suggested = MARKET_DEFAULT_LANGUAGE[value as string];
        const wasAuto = current.language === MARKET_DEFAULT_LANGUAGE[current.market];
        if (suggested && wasAuto) next.language = suggested;
      }
      return next;
    });
  }

  function remember() {
    try {
      window.localStorage.setItem(INPUT_KEY, JSON.stringify(inputs));
    } catch {
      /* ignore */
    }
  }

  /**
   * Starts a custom run, and says so.
   *
   * The warning is the one to read. It means the engine started something that
   * is not a custom run, and so stays on screen until it is dismissed.
   */
  async function start(
    body: Record<string, unknown>,
  ): Promise<{ id: string; note: string } | null> {
    const response = await fetch("/api/custom/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.status === 401) {
      window.location.href = "/login";
      return null;
    }
    const payload = await response.json();
    if (!response.ok) {
      if (payload.kind === "engine-outdated") setEngineReady(false);
      throw new Error(payload.error ?? "The run could not be started.");
    }
    if (payload.warning) push("bad", String(payload.warning));
    void loadRuns();
    if (!payload.executionId) return null;
    // The note is the engine saying the run is queued behind others, which is
    // the answer to "why has it not started" before anybody asks it.
    return { id: String(payload.executionId), note: payload.note ? ` ${payload.note}` : "" };
  }

  // A saved type that has since gone is sent as "detect", not as a dead id.
  const typeId = pageTypes.some((one) => one.id === inputs.pageTypeId) ? inputs.pageTypeId : "";
  const chosenType = pageTypes.find((one) => one.id === typeId) ?? null;
  const optimising = inputs.action === "optimise";

  const pageProblem = (() => {
    if (!inputs.pageUrl.trim()) return null;
    const url = webAddress(inputs.pageUrl);
    if (!url) return "That is not a web address. Include https://";
    if (url.pathname === "/" || !url.pathname) {
      return "That is a whole site. Give the address of the one page to rewrite.";
    }
    return null;
  })();
  const siteProblem =
    inputs.siteUrl.trim() && !webAddress(inputs.siteUrl)
      ? "That is not a web address. Include https://"
      : null;
  const sourceProblem =
    inputs.sourceUrl.trim() && !webAddress(inputs.sourceUrl)
      ? "That is not a web address. Include https://"
      : null;

  const runFilled = optimising
    ? Boolean(inputs.pageUrl.trim()) && !pageProblem
    : Boolean(inputs.siteUrl.trim() && inputs.sourceUrl.trim()) && !siteProblem && !sourceProblem;
  const canStart = ready && runFilled && !starting && Boolean(inputs.market && inputs.language);

  async function startPageRun() {
    if (!canStart) return;
    remember();
    setStarting(true);
    try {
      const started = await start({
        action: inputs.action,
        page_type_id: typeId,
        website_url: optimising ? inputs.pageUrl.trim() : inputs.siteUrl.trim(),
        source_url: optimising ? "" : inputs.sourceUrl.trim(),
        publish_new_pages: !optimising && inputs.publishNow,
        market: inputs.market,
        language: inputs.language,
      });
      if (started) {
        selectRun(started.id);
        push("ok", `Started run ${started.id}. Its progress is below.${started.note}`);
      }
    } catch (e) {
      push("bad", e instanceof Error ? e.message : "The run could not be started.");
    } finally {
      setStarting(false);
    }
  }

  // ------------------------------------------------------------ design

  const exampleList = [...new Set(examples.split(/[\s,]+/).map((one) => one.trim()).filter(Boolean))];
  const exampleProblem = !exampleList.length
    ? null
    : exampleList.length > 3
      ? "Three at most. More examples make a vaguer type, not a better one."
      : exampleList.find((one) => !webAddress(one))
        ? `${exampleList.find((one) => !webAddress(one))} is not a web address. Include https://`
        : null;
  const canDraft =
    ready &&
    exampleList.length > 0 &&
    !exampleProblem &&
    designNote.length <= 1000 &&
    !drafting &&
    Boolean(inputs.market && inputs.language);

  async function startDesign() {
    if (!canDraft) return;
    remember();
    setDrafting(true);
    try {
      const started = await start({
        action: "design",
        example_urls: exampleList,
        design_note: designNote.trim(),
        market: inputs.market,
        language: inputs.language,
      });
      if (started) {
        setDesignError(null);
        setDesignHiccup(null);
        setDesignDraft(null);
        setDesignSavedAs(null);
        setDesignRun(started.id);
        push(
          "ok",
          `Drafting. It takes a few minutes, and the draft opens here when it is ready.${started.note}`,
        );
      }
    } catch (e) {
      push("bad", e instanceof Error ? e.message : "The draft could not be started.");
    } finally {
      setDrafting(false);
    }
  }

  /*
   * Following a design run to its draft.
   *
   * Asked on its own clock, one question at a time, and stopped the moment the
   * run finishes. The draft opens in the editor as soon as it arrives, and is
   * kept so closing the editor does not throw away what the run cost.
   */
  useEffect(() => {
    if (!designRun) return;
    let stopped = false;
    let timer: number | undefined;

    const check = async () => {
      try {
        const response = await fetch(`/api/custom/drafts/${encodeURIComponent(designRun)}`, {
          cache: "no-store",
        });
        if (stopped) return;
        if (response.status === 401) {
          window.location.href = "/login";
          return;
        }
        const payload = await response.json();
        if (stopped) return;

        if (!response.ok) {
          // These will not get better by asking again.
          if ([400, 403, 404, 409].includes(response.status)) {
            setDesignError(payload.error ?? "The draft could not be read.");
            return;
          }
          throw new Error(payload.error ?? "The draft could not be read.");
        }

        const state = payload as DesignDraft;
        setDesignHiccup(null);
        if (state.finished) {
          if (state.draft) {
            setDesignDraft(state.draft);
            // Not over somebody's unsaved edit to another type. The draft
            // waits behind its own button instead.
            if (editorOpen.current) {
              push("ok", "Your draft is ready. Open it from Create from examples.");
            } else {
              openDraft(state.draft);
            }
          } else {
            setDesignError(
              state.error ??
                (state.status === "canceled"
                  ? "The run was stopped before it drafted anything."
                  : "The run finished without drafting a page type."),
            );
          }
          return;
        }
      } catch (e) {
        if (stopped) return;
        setDesignHiccup(e instanceof Error ? e.message : "The draft could not be read.");
      }
      if (!stopped) timer = window.setTimeout(() => void check(), DRAFT_POLL);
    };

    void check();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [designRun, openDraft, push]);

  /** A finished design run picked from the list, opened again. */
  async function reopenDraft(id: string) {
    setReopening(true);
    try {
      const response = await fetch(`/api/custom/drafts/${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "The draft could not be read.");
      const state = payload as DesignDraft;
      if (!state.draft) {
        throw new Error(state.error ?? "That run has no draft to open.");
      }
      openDraft(state.draft);
    } catch (e) {
      push("bad", e instanceof Error ? e.message : "The draft could not be read.");
    } finally {
      setReopening(false);
    }
  }

  // ------------------------------------------------------------ run actions

  async function stop(id: string, done: () => void, setBusy: (busy: boolean) => void) {
    setBusy(true);
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(id)}/stop`, { method: "POST" });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "The run could not be stopped.");
      push("ok", `Stopping run ${id}.`);
      done();
      void loadRuns();
    } catch (e) {
      push("bad", e instanceof Error ? e.message : "The run could not be stopped.");
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    if (!selected) return;
    const from = selected;
    setRetrying(true);
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(from)}/retry`, {
        method: "POST",
      });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "The run could not be resumed.");

      // The engine starts a new run for a retry, so that is the one to watch.
      if (payload.id && String(payload.id) !== from) {
        push("ok", `Retrying ${from} as ${payload.id}, reusing what the first attempt paid for.`);
        selectRun(String(payload.id));
      } else {
        push("ok", `Resumed ${from}.`);
        void chosen.reload(from);
      }
      void loadRuns();
    } catch (e) {
      push("bad", e instanceof Error ? e.message : "The run could not be resumed.");
    } finally {
      setRetrying(false);
    }
  }

  const selectedRun = runs.find((one) => one.id === selected) ?? null;
  // A design run has no page to start again from, and the retry route refuses
  // one for exactly that reason. Drafting again is the way back.
  const retryable = selectedRun?.action !== "design";

  // ------------------------------------------------------------ render

  const marketFields = (prefix: string) => (
    <div className="row-2">
      <div className="field">
        <label id={`${prefix}-market-label`} htmlFor={`${prefix}-market`}>
          Market
        </label>
        <Select
          id={`${prefix}-market`}
          labelledBy={`${prefix}-market-label`}
          value={inputs.market}
          onChange={(value) => setInput("market", value)}
          options={MARKETS.map((m) => ({ value: m.code, label: m.label, hint: m.code }))}
        />
      </div>
      <div className="field">
        <label id={`${prefix}-language-label`} htmlFor={`${prefix}-language`}>
          Language
        </label>
        <Select
          id={`${prefix}-language`}
          labelledBy={`${prefix}-language-label`}
          value={inputs.language}
          onChange={(value) => setInput("language", value)}
          options={LANGUAGES.map((l) => ({ value: l.code, label: l.label, hint: l.code }))}
        />
      </div>
    </div>
  );

  return (
    <div className="stack custom-view">
      {engineReady === false ? (
        <div className="notice warn" role="alert">
          <strong>The engine hasn&rsquo;t been updated for page types yet.</strong> Run:{" "}
          <code>cd /opt/src &amp;&amp; git pull &amp;&amp; docker compose up -d --build</code>{" "}
          Nothing can be started here until it has been, because an engine
          that does not know these runs would rewrite the page instead.
        </div>
      ) : null}
      {typesError ? <div className="notice bad">{typesError}</div> : null}

      <section className="card">
        <div className="card-head has-mid">
          <div>
            <h2>Custom</h2>
            <p>Page types you define, and the engine run with them.</p>
          </div>

          <div className="card-head-mid">
            <div className="seg seg-sm">
              {(
                [
                  ["types", "Page types"],
                  ["design", "Create from examples"],
                  ["run", "Run"],
                ] as Array<[Tab, string]>
              ).map(([which, label]) => (
                <button
                  key={which}
                  type="button"
                  aria-pressed={tab === which}
                  className={tab === which ? "seg-btn is-on" : "seg-btn"}
                  onClick={() => setTab(which)}
                >
                  {label}
                  {which === "types" && pageTypes.length ? (
                    <span className="seg-count">{pageTypes.length}</span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>

          {tab === "types" ? (
            <div className="app-head-actions">
              <button
                type="button"
                className="btn btn-ghost head-do"
                onClick={() => openEditor(POKER_EXAMPLE, "example")}
              >
                Start from the poker player example
              </button>
              <button
                type="button"
                className="btn btn-primary head-do is-new"
                onClick={() => openEditor(BLANK_TYPE, "new")}
              >
                New page type
              </button>
            </div>
          ) : null}
        </div>

        <div className="card-body">
          {tab === "types" ? (
            <div className="mail-panel" key="types">
              {typesLoading ? (
                <p className="provider-hint history-empty">Reading the page types…</p>
              ) : !pageTypes.length ? (
                <div className="empty">
                  No page types yet. The poker player example is a complete one
                  to read and adapt; or describe your own from scratch, or let
                  the engine draft one from pages that already look right.
                  <div className="pt-empty-actions">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => openEditor(POKER_EXAMPLE, "example")}
                    >
                      Start from the example
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setTab("design")}
                    >
                      Create from examples
                    </button>
                  </div>
                </div>
              ) : (
                <ul className="prompt-list">
                  {pageTypes.map((one) => (
                    <li className="prompt" key={one.id}>
                      <div className="prompt-head">
                        <strong>{one.name}</strong>
                        <span className="prompt-when">
                          {one.updatedBy ? `${one.updatedBy}, ` : ""}
                          {formatWhen(one.updatedAt || null)}
                        </span>
                        <div className="spacer" />
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={!ready}
                          title={ready ? "Use this type on the Run tab" : "The engine needs updating first"}
                          onClick={() => {
                            setInput("pageTypeId", one.id);
                            setTab("run");
                          }}
                        >
                          Run with it
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={deleting === one.id}
                          onClick={() => openEditor(one, "saved")}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm prompt-drop"
                          disabled={deleting === one.id}
                          onClick={() => void remove(one)}
                        >
                          {deleting === one.id ? "Deleting…" : "Delete"}
                        </button>
                      </div>
                      {one.description ? <p className="pt-desc">{excerpt(one.description)}</p> : null}
                      <div className="pt-tags">
                        {one.blocks.map((block) => (
                          <span className="pill pill-idle" key={block}>
                            {BLOCK_LABELS[block] ?? block}
                          </span>
                        ))}
                        {one.schemaType ? <span className="pill pill-run">{one.schemaType}</span> : null}
                        <span className="quiet">
                          {one.facts.length} fact{one.facts.length === 1 ? "" : "s"} ·{" "}
                          {one.outline.length} section{one.outline.length === 1 ? "" : "s"}
                          {one.words ? ` · about ${one.words} words` : ""}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : tab === "design" ? (
            <div className="mail-panel pt-split" key="design">
              <form
                className="pt-form"
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  void startDesign();
                }}
              >
                <div className="field">
                  <label htmlFor="custom-examples">Example pages</label>
                  <textarea
                    id="custom-examples"
                    rows={4}
                    className="mono"
                    spellCheck={false}
                    value={examples}
                    placeholder={"https://example.com/players/one-player/\nhttps://another.com/pros/another-player/"}
                    aria-invalid={Boolean(exampleProblem)}
                    onChange={(e) => setExamples(e.target.value)}
                  />
                  {exampleProblem ? (
                    <div className="err">{exampleProblem}</div>
                  ) : (
                    <div className="note">
                      One to three pages of the kind you want, one per line, from
                      any site. They are read to learn the shape, never copied.
                    </div>
                  )}
                </div>

                <div className="field">
                  <label htmlFor="custom-design-note">What kind of page is this?</label>
                  <textarea
                    id="custom-design-note"
                    rows={3}
                    maxLength={1000}
                    value={designNote}
                    placeholder="Biographies of professional poker players, for fans who want the facts in one place."
                    onChange={(e) => setDesignNote(e.target.value)}
                  />
                  <div className="note">
                    Optional. Whatever the examples do not make obvious: who the
                    pages are for, what they must always cover. {designNote.length}/1000
                  </div>
                </div>

                {marketFields("design")}

                <div className="loop-actions">
                  <button type="submit" className="btn btn-primary" disabled={!canDraft}>
                    {drafting ? "Starting…" : "Draft a page type"}
                  </button>
                </div>
                <p className="quiet pt-cost">
                  Nothing is published. The draft opens in the editor for you to
                  read, correct and save. The run costs money at the model like
                  any other.
                </p>
              </form>

              <div className="pt-follow">
                {designRun ? (
                  <>
                    <div className="pt-follow-head">
                      <h3>Drafting from your examples</h3>
                      <div className="spacer" />
                      {designDraft ? (
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => openDraft(designDraft)}
                        >
                          Review the draft
                        </button>
                      ) : null}
                    </div>
                    {designSavedAs ? (
                      <div className="notice ok">
                        Saved as {designSavedAs}. It is on the Page types tab.
                      </div>
                    ) : null}
                    {designError ? <div className="notice bad">{designError}</div> : null}
                    {designHiccup && !designError ? (
                      <p className="quiet">Could not check just now ({designHiccup}). Trying again.</p>
                    ) : null}
                    {followed.error && designRun !== selected ? (
                      <p className="quiet">{followed.error}</p>
                    ) : null}
                    <RunProgress
                      execution={designDetail}
                      loading={Boolean(designLoading) && !designDetail}
                      onCancel={() =>
                        void stop(
                          designRun,
                          () => void (designRun === selected ? chosen : followed).reload(designRun),
                          setStoppingDesign,
                        )
                      }
                      cancelling={stoppingDesign}
                    />
                  </>
                ) : (
                  <div className="empty">
                    The run appears here once it starts. Drafting reads each
                    example, works out what they have in common and writes it up
                    as a page type; it usually takes a few minutes.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <form
              className="mail-panel pt-form"
              key="run"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                void startPageRun();
              }}
            >
              <div className="field">
                <span className="field-label" id="custom-action-label">
                  What to do
                </span>
                <div className="seg seg-sm" role="group" aria-labelledby="custom-action-label">
                  {(
                    [
                      ["optimise", "Optimise a page"],
                      ["add", "Add a new page"],
                    ] as Array<[Inputs["action"], string]>
                  ).map(([which, label]) => (
                    <button
                      key={which}
                      type="button"
                      aria-pressed={inputs.action === which}
                      className={inputs.action === which ? "seg-btn is-on" : "seg-btn"}
                      onClick={() => setInput("action", which)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="note">
                  {optimising
                    ? "Rewrites one page that already exists on your site and updates it in WordPress."
                    : "Writes a page your site does not have yet, about the subject of a page somewhere else."}
                </div>
              </div>

              <div className="field">
                <label id="custom-type-label" htmlFor="custom-type">
                  Page type
                </label>
                <Select
                  id="custom-type"
                  labelledBy="custom-type-label"
                  value={typeId}
                  onChange={(value) => setInput("pageTypeId", value)}
                  options={[
                    { value: "", label: "Detect automatically" },
                    ...pageTypes.map((one) => ({ value: one.id, label: one.name })),
                  ]}
                />
                <div className="note">
                  {chosenType
                    ? excerpt(chosenType.description, 160)
                    : "The engine compares the page with your saved types and uses the one that fits. If none does, it plans the page itself."}
                </div>
              </div>

              {optimising ? (
                <div className="field">
                  <label htmlFor="custom-page">Page address</label>
                  <input
                    id="custom-page"
                    type="url"
                    inputMode="url"
                    spellCheck={false}
                    placeholder="https://yoursite.com/players/some-player/"
                    value={inputs.pageUrl}
                    aria-invalid={Boolean(pageProblem)}
                    onChange={(e) => setInput("pageUrl", e.target.value)}
                  />
                  {pageProblem ? (
                    <div className="err">{pageProblem}</div>
                  ) : (
                    <div className="note">
                      The full address of one page. It is rewritten to the type
                      and updated where it is.
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div className="row-2">
                    <div className="field">
                      <label htmlFor="custom-site">Your website</label>
                      <input
                        id="custom-site"
                        type="url"
                        inputMode="url"
                        spellCheck={false}
                        placeholder="https://yoursite.com"
                        value={inputs.siteUrl}
                        aria-invalid={Boolean(siteProblem)}
                        onChange={(e) => setInput("siteUrl", e.target.value)}
                      />
                      {siteProblem ? (
                        <div className="err">{siteProblem}</div>
                      ) : (
                        <div className="note">
                          Where the new page is created. Its WordPress login comes
                          from Website Accounts.
                        </div>
                      )}
                    </div>
                    <div className="field">
                      <label htmlFor="custom-source">Source page</label>
                      <input
                        id="custom-source"
                        type="url"
                        inputMode="url"
                        spellCheck={false}
                        placeholder="https://elsewhere.com/players/some-player/"
                        value={inputs.sourceUrl}
                        aria-invalid={Boolean(sourceProblem)}
                        onChange={(e) => setInput("sourceUrl", e.target.value)}
                      />
                      {sourceProblem ? (
                        <div className="err">{sourceProblem}</div>
                      ) : (
                        <div className="note">
                          A page anywhere about the subject. It says what to write
                          about; the page itself comes from the research.
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="field">
                    <label className="check" htmlFor="custom-publish">
                      <input
                        id="custom-publish"
                        type="checkbox"
                        checked={inputs.publishNow}
                        onChange={(e) => setInput("publishNow", e.target.checked)}
                      />
                      Publish immediately
                    </label>
                    <div className="note">
                      {inputs.publishNow
                        ? "The page goes live as soon as it is written."
                        : "Off. The page is saved as a draft in WordPress for somebody to read first."}
                    </div>
                  </div>
                </>
              )}

              {marketFields("run")}

              <div className="loop-actions">
                <button type="submit" className="btn btn-primary" disabled={!canStart}>
                  {starting ? "Starting…" : optimising ? "Start optimising" : "Start writing"}
                </button>
              </div>
              <p className="quiet pt-cost">Every run costs money at the model.</p>
            </form>
          )}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Custom runs</h2>
            <p>
              Runs started on this page, newest first. Anything started from
              Optimize or a loop is on those pages instead.
            </p>
          </div>
        </div>

        <div className="card-body">
          {runsLoading ? (
            <p className="provider-hint history-empty">Reading the runs…</p>
          ) : runsError ? (
            <div className="notice bad">{runsError}</div>
          ) : !runs.length && !selected ? (
            <p className="provider-hint history-empty">
              No custom runs yet. The first one you start appears here, and
              stays whatever happens to it.
            </p>
          ) : (
            <div className="mail-runs">
              {/* Beside the run rather than above it, so reading one after
                  another does not move the thing being read. */}
              <nav className="mail-runs-list" aria-label="Custom runs">
                {runs.map((one) => (
                  <button
                    key={one.id}
                    type="button"
                    className={one.id === selected ? "mail-run is-on" : "mail-run"}
                    aria-current={one.id === selected}
                    onClick={() => selectRun(one.id)}
                  >
                    <StatusBadge status={statusOf(one.status)} />
                    <span className="mail-run-anchor">
                      {ACTION_WORDS[one.action] ?? one.action} ·{" "}
                      {one.pageTypeName ||
                        (one.action === "design" ? "a new type" : "type detected")}
                    </span>
                    <span className="mail-run-id mono" title={one.target}>
                      {shortAddress(one.target)}
                    </span>
                    <span className="mail-run-at">{formatWhen(one.startedAt || null)}</span>
                  </button>
                ))}
              </nav>

              <div className="mail-runs-one">
                {chosen.error ? <div className="notice bad">{chosen.error}</div> : null}
                {selectedRun?.action === "design" && chosen.detail?.status === "success" ? (
                  <div className="pt-run-tools">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={reopening}
                      onClick={() => void reopenDraft(selectedRun.id)}
                    >
                      {reopening ? "Opening…" : "Review the drafted page type"}
                    </button>
                  </div>
                ) : null}
                <RunProgress
                  execution={chosen.detail}
                  loading={chosen.loading && !chosen.detail}
                  onCancel={() =>
                    selected
                      ? void stop(selected, () => void chosen.reload(selected), setCancelling)
                      : undefined
                  }
                  cancelling={cancelling}
                  onRetry={retryable ? () => void retry() : undefined}
                  retrying={retrying}
                />
              </div>
            </div>
          )}
        </div>
      </section>

      {editor ? (
        <PageTypeEditor
          key={editor.key}
          initial={editor.type}
          origin={editor.origin}
          existing={pageTypes}
          onClose={() => setEditor(null)}
          onSaved={saved}
        />
      ) : null}

      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
