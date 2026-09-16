"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useAsk } from "@/components/Ask";
import { Select } from "@/components/Select";
import {
  BLOCKS,
  BLOCK_LABELS,
  PAGE_TYPE_LIMITS as LIMITS,
  SCHEMA_TYPES,
  domainOf,
  factKeys,
  keyOf,
  ownerOf,
  urlPatternOf,
  type Block,
  type PageType,
  type SchemaType,
} from "@/lib/pagetypeshape";

/**
 * One page type, in a sheet.
 *
 * A type is twenty-odd fields, several of them lists of rows, and it is edited
 * rarely and read carefully. A sheet gives it the whole screen while it is open
 * and gives the page back when it is not, which an inline card the height of
 * three screens would not.
 *
 * Lists the engine keeps as arrays are held here as the text somebody typed,
 * one entry per line, and only split on the way out. A list field that splits
 * as you type eats the blank line you were about to fill in.
 *
 * The engine decides what a valid type is and says why when it is not, and
 * that sentence is shown at the top of the sheet where it cannot be missed
 * behind the backdrop. What can be known before saving is said here first,
 * beside the field: how many of each thing a type may hold, how long an entry
 * may be, and the entries the engine would otherwise drop or refuse. It used
 * to trim those without a word, and the sheet closed on "Saved" over a type
 * that had quietly lost them.
 *
 * Built on <dialog> and showModal, like every other sheet here.
 */

/** Where the type being edited came from. Decides the heading and nothing else. */
export type EditorOrigin = "saved" | "new" | "example" | "draft";

type FactRow = {
  uid: number;
  /** What was typed as the key. Only read while keyChosen is true. */
  key: string;
  label: string;
  hint: string;
  verify: boolean;
  schemaProperty: string;
  /**
   * Whether somebody chose the key. Until they do it follows the label, so a
   * new fact gets a sensible key without anybody typing one. A key that came
   * with the type stays put: the research and the structured data already
   * know it by that name.
   */
  keyChosen: boolean;
};

type SectionRow = { uid: number; heading: string; guidance: string };

interface Form {
  id: string;
  name: string;
  description: string;
  subject: string;
  urlPatterns: string;
  bodyClasses: string;
  examples: string;
  facts: FactRow[];
  trustedSources: string;
  outline: SectionRow[];
  rules: string;
  avoid: string;
  blocks: Block[];
  schemaType: SchemaType;
  postType: string;
  styleFrom: string;
  /** Text, so the box can be emptied while a new number is typed. */
  words: string;
}

// Rows are keyed on these rather than on their position, so moving a section
// up moves its inputs with it instead of swapping what two inputs hold.
let lastUid = 0;
const nextUid = () => ++lastUid;

const blankFact = (): FactRow => ({
  uid: nextUid(),
  key: "",
  label: "",
  hint: "",
  verify: true,
  schemaProperty: "",
  keyChosen: false,
});

const blankSection = (): SectionRow => ({ uid: nextUid(), heading: "", guidance: "" });

function formOf(type: PageType): Form {
  return {
    id: type.id ?? "",
    name: type.name ?? "",
    description: type.description ?? "",
    subject: type.subject ?? "",
    urlPatterns: (type.recognise?.urlPatterns ?? []).join("\n"),
    bodyClasses: (type.recognise?.bodyClasses ?? []).join("\n"),
    examples: (type.recognise?.examples ?? []).join("\n"),
    facts: (type.facts ?? []).map((fact) => ({
      uid: nextUid(),
      key: fact.key ?? "",
      label: fact.label ?? "",
      hint: fact.hint ?? "",
      verify: fact.verify !== false,
      schemaProperty: fact.schemaProperty ?? "",
      keyChosen: Boolean(fact.key),
    })),
    trustedSources: (type.trustedSources ?? []).join("\n"),
    outline: (type.outline ?? []).map((section) => ({
      uid: nextUid(),
      heading: section.heading ?? "",
      guidance: section.guidance ?? "",
    })),
    rules: (type.rules ?? []).join("\n"),
    avoid: (type.avoid ?? []).join("\n"),
    blocks: (type.blocks ?? []).filter((one) => (BLOCKS as readonly string[]).includes(one)),
    schemaType: (SCHEMA_TYPES as readonly string[]).includes(type.schemaType ?? "")
      ? (type.schemaType ?? "")
      : "",
    postType: type.wordpress?.postType ?? "",
    styleFrom: type.wordpress?.styleFrom ?? "",
    words: type.words ? String(type.words) : "",
  };
}

/**
 * One entry per line, blank lines and repeats dropped.
 *
 * Spaces inside an entry are made one first, as the engine does before it
 * compares and counts, so two lines that differ only there are one entry here
 * too and the count matches the engine's.
 */
function lines(text: string): string[] {
  return [
    ...new Set(text.split(/\r?\n/).map((one) => one.replace(/\s+/g, " ").trim()).filter(Boolean)),
  ];
}

/**
 * One entry per line, or per space or comma.
 *
 * For lists whose entries never contain a space. A class attribute pasted
 * whole is several classes on one line, and the engine strips the spaces out
 * of an entry rather than splitting on them, so splitting is done here.
 */
function tokens(text: string, strip: RegExp | null = null): string[] {
  return [
    ...new Set(
      text
        .split(/[\s,]+/)
        .map((one) => (strip ? one.replace(strip, "") : one).trim())
        .filter(Boolean),
    ),
  ];
}

/** The facts that are saved, which are the ones with a label, and their keys. */
function savedFacts(facts: FactRow[]): { rows: FactRow[]; keys: string[] } {
  const rows = facts.filter((fact) => fact.label.trim());
  const keys = factKeys(
    rows.map((fact) => ({ key: fact.keyChosen ? fact.key : "", label: fact.label })),
  );
  return { rows, keys };
}

/** A name the way two are compared: trimmed, one space between words, any case. */
function sameName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().toLowerCase();
}

function clip(text: string, most = 40): string {
  return text.length > most ? `${text.slice(0, most)}…` : text;
}

/**
 * Why a list typed one entry per line would be refused, or null.
 *
 * The engine refuses more entries than it keeps and an entry longer than it
 * keeps, naming the field; this says the same before the save.
 */
function listProblem(
  entries: string[],
  most: number,
  longest: number,
  what: string,
): string | null {
  if (entries.length > most) return `At most ${most} ${what}. There are ${entries.length}.`;
  // Measured as the engine keeps it, with runs of spaces made one.
  const long = entries.find((one) => one.replace(/\s+/g, " ").length > longest);
  if (long) return `"${clip(long)}" is longer than ${longest} characters.`;
  return null;
}

function typeOf(form: Form, owner: string | undefined): Partial<PageType> {
  const facts = savedFacts(form.facts);
  return {
    id: form.id,
    // Whose type an edit is, so somebody with full access edits that person's
    // type rather than making a copy of their own. Ignored on a new type.
    ...(form.id && owner !== undefined ? { owner } : {}),
    name: form.name.trim(),
    description: form.description.trim(),
    subject: form.subject.trim(),
    recognise: {
      urlPatterns: lines(form.urlPatterns),
      // A leading dot is what copying a selector out of devtools gives you.
      bodyClasses: tokens(form.bodyClasses, /^\.+/),
      examples: tokens(form.examples),
    },
    facts: facts.rows.map((fact, at) => ({
      key: facts.keys[at]!,
      label: fact.label.trim(),
      hint: fact.hint.trim(),
      verify: fact.verify,
      schemaProperty: fact.schemaProperty.trim(),
    })),
    trustedSources: tokens(form.trustedSources),
    outline: form.outline
      .filter((section) => section.heading.trim())
      .map((section) => ({ heading: section.heading.trim(), guidance: section.guidance.trim() })),
    rules: lines(form.rules),
    avoid: lines(form.avoid),
    blocks: BLOCKS.filter((one) => form.blocks.includes(one)),
    schemaType: form.schemaType,
    wordpress: { postType: form.postType.trim(), styleFrom: form.styleFrom.trim() },
    words: Math.max(0, Math.round(Number(form.words) || 0)),
  };
}

const HEADINGS: Record<EditorOrigin, string> = {
  saved: "Edit page type",
  new: "New page type",
  example: "New page type, from the example",
  draft: "Drafted from your examples",
};

const INTROS: Record<EditorOrigin, string> = {
  saved: "Runs that use this type follow the saved version from the moment it is saved.",
  new: "Describe a kind of page once, and every custom run of that kind is written to it.",
  example: "A complete type to start from. Change what does not fit, then save it as your own.",
  draft:
    "The engine read your examples and wrote this. Nothing is saved yet: read it through, " +
    "correct it, and save it when it says what you mean.",
};

export default function PageTypeEditor({
  initial,
  origin,
  existing,
  viewer,
  onClose,
  onSaved,
}: {
  initial: PageType;
  origin: EditorOrigin;
  /** The saved types the viewer can see, to warn before a name is refused. */
  existing: PageType[];
  /** Who is signed in. A new type is theirs; an edit stays with its owner. */
  viewer: string;
  onClose: () => void;
  /** The type as the engine saved it, and the whole list as it now is. */
  onSaved: (saved: PageType, all: PageType[]) => void;
}) {
  const ask = useAsk();
  const shell = useRef<HTMLDialogElement>(null);

  const [form, setForm] = useState<Form>(() => formOf(initial));
  const [dirty, setDirty] = useState(origin === "draft" || origin === "example");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Read by the cancel handler, which is registered once and would otherwise
  // see the values from the render that registered it.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  function change(update: (current: Form) => Form) {
    setForm(update);
    setDirty(true);
  }

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    change((current) => ({ ...current, [key]: value }));
  }

  /**
   * Closing, with a question first if something would be lost.
   *
   * A draft from examples is always worth the question: it cost a run, and
   * closing it unsaved throws that away.
   */
  const leave = useCallback(async () => {
    if (busyRef.current) return;
    if (dirtyRef.current) {
      const sure = await ask.confirm({
        title: "Close without saving?",
        body: <>What you have changed here is lost. Saved page types are not touched.</>,
        confirmLabel: "Close without saving",
        cancelLabel: "Keep editing",
        tone: "danger",
      });
      if (!sure) return;
    }
    onClose();
  }, [ask, onClose]);

  useEffect(() => {
    const dialog = shell.current;
    if (!dialog) return;
    if (!dialog.open) {
      dialog.showModal();
      // After opening, not before: showModal moves focus itself, so focusing
      // the name any earlier is undone. Only on a blank type, where the name
      // is the obvious first thing to write.
      if (origin === "new") dialog.querySelector<HTMLInputElement>("#pt-name")?.focus();
    }

    // Escape closes a <dialog> natively, which would skip the question above.
    const onCancel = (e: Event) => {
      e.preventDefault();
      void leave();
    };
    dialog.addEventListener("cancel", onCancel);
    return () => dialog.removeEventListener("cancel", onCancel);
  }, [leave, origin]);

  async function save() {
    if (busy || !form.name.trim() || blocked) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/custom/types", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(typeOf(form, form.id ? ownerOf(initial) : undefined)),
      });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "The page type could not be saved.");
      onSaved(payload.pageType, payload.pageTypes ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The page type could not be saved.");
      // The message is at the top of a sheet that may be scrolled far down.
      shell.current?.querySelector(".sheet-body")?.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setBusy(false);
    }
  }

  // ---------------------------------------------------------------- facts

  function setFact(uid: number, patch: Partial<FactRow>) {
    change((current) => ({
      ...current,
      facts: current.facts.map((fact) => {
        if (fact.uid !== uid) return fact;
        // A key nobody chose is worked out from the label when shown and when
        // saved, not kept here, so it cannot fall behind the label.
        return { ...fact, ...patch };
      }),
    }));
  }

  function dropFact(uid: number) {
    change((current) => ({ ...current, facts: current.facts.filter((f) => f.uid !== uid) }));
  }

  // ---------------------------------------------------------------- outline

  function setSection(uid: number, patch: Partial<SectionRow>) {
    change((current) => ({
      ...current,
      outline: current.outline.map((one) => (one.uid === uid ? { ...one, ...patch } : one)),
    }));
  }

  function moveSection(at: number, by: -1 | 1) {
    change((current) => {
      const to = at + by;
      if (to < 0 || to >= current.outline.length) return current;
      const outline = [...current.outline];
      [outline[at], outline[to]] = [outline[to]!, outline[at]!];
      return { ...current, outline };
    });
  }

  function dropSection(uid: number) {
    change((current) => ({ ...current, outline: current.outline.filter((s) => s.uid !== uid) }));
  }

  function toggleBlock(block: Block) {
    change((current) => ({
      ...current,
      blocks: current.blocks.includes(block)
        ? current.blocks.filter((one) => one !== block)
        : [...current.blocks, block],
    }));
  }

  /*
   * Everything that can be known to fail before saving, by field.
   *
   * A new type is the viewer's; an edit stays with its owner. The engine
   * refuses a name that owner already uses on another type, when the name is
   * new for this one — a new type, or a rename. Only that owner's types count:
   * somebody with full access also sees other people's, whose names do not
   * stand in the way. Two types that already shared a name can still be
   * edited, and are only worth a word.
   */
  const me = viewer.trim().toLowerCase();
  const owner = form.id ? ownerOf(initial) : me;
  const wanted = sameName(form.name);
  const namesake = wanted
    ? existing.find(
        (one) =>
          ownerOf(one) === owner &&
          sameName(one.name) === wanted &&
          !(form.id && one.id === form.id),
      )
    : undefined;
  const renamed = !form.id || sameName(initial.name ?? "") !== wanted;
  const whose =
    owner === me ? "You already have" : owner ? `${owner} already has` : "Nobody's types already include";

  const facts = savedFacts(form.facts);
  const keyByUid = new Map(facts.rows.map((fact, at) => [fact.uid, facts.keys[at]!]));
  const firstWithKey = new Map<string, number>();
  facts.rows.forEach((fact, at) => {
    const key = facts.keys[at]!;
    if (!firstWithKey.has(key)) firstWithKey.set(key, fact.uid);
  });
  const keyClash = (uid: number): string | null => {
    const key = keyByUid.get(uid);
    return key && firstWithKey.get(key) !== uid ? key : null;
  };

  const patternLines = lines(form.urlPatterns);
  const patterns = patternLines.map(urlPatternOf);
  // Counted the way the engine counts them: as what is kept, repeats once.
  const classList = [
    ...new Set(
      tokens(form.bodyClasses, /^\.+/)
        .map((one) => one.replace(/[^A-Za-z0-9_-]/g, ""))
        .filter(Boolean),
    ),
  ];
  const exampleList = tokens(form.examples);
  const sourceList = tokens(form.trustedSources);
  const domains = [...new Set(sourceList.map(domainOf).filter((one) => one.includes(".")))];
  const ruleLines = lines(form.rules);
  const avoidLines = lines(form.avoid);
  const words = Number(form.words) || 0;

  const problems = {
    name:
      namesake && renamed
        ? `${whose} a type called ${namesake.name}. Pick another name${form.id ? "" : ", or close this and edit that one"}.`
        : null,
    patterns: patterns.includes("/")
      ? "A URL pattern of just / would claim every page."
      : listProblem([...new Set(patterns)], LIMITS.patterns, LIMITS.pattern, "address patterns"),
    bodyClasses: listProblem(classList, LIMITS.bodyClasses, LIMITS.bodyClass, "body classes"),
    examples:
      listProblem(exampleList, LIMITS.examples, LIMITS.example, "examples") ??
      (() => {
        const wrong = exampleList.find((one) => !/^https?:\/\//i.test(one));
        return wrong ? `${clip(wrong)} is not a web address. Include https://` : null;
      })(),
    facts:
      facts.rows.length > LIMITS.facts
        ? `At most ${LIMITS.facts} facts. There are ${facts.rows.length}.`
        : facts.rows.some((fact) => keyClash(fact.uid))
          ? "Two facts have the same key. Give each one a key of its own."
          : null,
    sources:
      (() => {
        const wrong = sourceList.find((one) => !domainOf(one).includes("."));
        return wrong ? `${clip(wrong)} is not a domain. Write it like thehendonmob.com.` : null;
      })() ?? listProblem(domains, LIMITS.sources, LIMITS.source, "trusted sources"),
    outline:
      form.outline.filter((one) => one.heading.trim()).length > LIMITS.outline
        ? `At most ${LIMITS.outline} sections.`
        : null,
    rules: listProblem(ruleLines, LIMITS.rules, LIMITS.rule, "writing rules"),
    avoid: listProblem(avoidLines, LIMITS.rules, LIMITS.rule, "lines of what never to do"),
    styleFrom:
      form.styleFrom.trim() && !/^https?:\/\//i.test(form.styleFrom.trim())
        ? "Give the whole address, starting with https://"
        : null,
    words: words > LIMITS.words ? `At most ${LIMITS.words} words.` : null,
  };
  const blocked = Object.values(problems).some(Boolean);
  // What the patterns are kept as, when that is not what was typed.
  const patternsRewritten =
    !problems.patterns && patterns.some((one, at) => one !== patternLines[at]);

  const title = origin === "saved" && initial.name ? `Edit ${initial.name}` : HEADINGS[origin];
  const theirs = origin === "saved" && form.id && ownerOf(initial) !== me;

  return (
    <dialog className="sheet pt-sheet" ref={shell} aria-labelledby="pt-title">
      {/* Not a form. Twenty fields is twenty places where Enter would
          otherwise save over the type half-way through an edit. */}
      <div className="sheet-card">
        <div className="sheet-head">
          <div>
            <h2 id="pt-title">{title}</h2>
            <p>
              {INTROS[origin]}
              {theirs
                ? ` This is ${ownerOf(initial) ? `${ownerOf(initial)}'s` : "nobody's"} type, and stays theirs when saved.`
                : ""}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={busy}
            onClick={() => void leave()}
          >
            Close
          </button>
        </div>

        <div className="sheet-body">
          {error ? (
            <div className="notice bad" role="alert">
              {error}
            </div>
          ) : null}

          {/* ------------------------------------------------ what it is */}
          <section className="sheet-section">
            <h3>What it is</h3>
            <p className="stage-hint">
              The engine reads the description to recognise such a page and the
              writer reads it to know who the page is for.
            </p>

            <div className="row-2">
              <div className="field">
                <label htmlFor="pt-name">Name</label>
                <input
                  id="pt-name"
                  type="text"
                  value={form.name}
                  maxLength={LIMITS.name}
                  placeholder="Poker player biography"
                  aria-invalid={Boolean(problems.name)}
                  onChange={(e) => set("name", e.target.value)}
                />
                {problems.name ? (
                  <div className="err">{problems.name}</div>
                ) : namesake ? (
                  <div className="note pt-warn">
                    {whose} another type called {namesake.name}. Two with one name
                    are hard to tell apart.
                  </div>
                ) : null}
              </div>
              <div className="field">
                <label htmlFor="pt-subject">What one page is about</label>
                <input
                  id="pt-subject"
                  type="text"
                  value={form.subject}
                  maxLength={LIMITS.subject}
                  placeholder="player"
                  onChange={(e) => set("subject", e.target.value)}
                />
                <div className="note">One or two words: player, provider, tournament.</div>
              </div>
            </div>

            <div className="field">
              <label htmlFor="pt-description">Description</label>
              <textarea
                id="pt-description"
                rows={4}
                value={form.description}
                maxLength={LIMITS.description}
                placeholder="A biography of a professional poker player: who they are, their biggest results… Written for poker fans who want the facts in one place."
                onChange={(e) => set("description", e.target.value)}
              />
              <div className="note">
                Kept as one paragraph: line breaks are not saved.{" "}
                {form.description.length}/{LIMITS.description}
              </div>
            </div>
          </section>

          {/* ------------------------------------------------ recognising */}
          <section className="sheet-section">
            <h3>How to recognise one</h3>
            <p className="stage-hint">
              Used when a run is left to detect the type. Any one of these
              matching is a strong hint; none of them is required.
            </p>

            <div className="row-2">
              <div className="field">
                <label htmlFor="pt-patterns">Address patterns</label>
                <textarea
                  id="pt-patterns"
                  rows={3}
                  className="mono"
                  spellCheck={false}
                  value={form.urlPatterns}
                  placeholder={"/players/\n/poker-players/"}
                  aria-invalid={Boolean(problems.patterns)}
                  onChange={(e) => set("urlPatterns", e.target.value)}
                />
                {problems.patterns ? <div className="err">{problems.patterns}</div> : null}
                <div className="note">
                  One per line. Part of an address that marks such a page. A
                  whole address is cut to its path, and every pattern is kept
                  in lower case, starting with /.{" "}
                  {new Set(patterns).size} of {LIMITS.patterns}.
                </div>
                {patternsRewritten ? (
                  <div className="note">Saved as: {patterns.join(", ")}</div>
                ) : null}
              </div>
              <div className="field">
                <label htmlFor="pt-classes">Body classes</label>
                <textarea
                  id="pt-classes"
                  rows={3}
                  className="mono"
                  spellCheck={false}
                  value={form.bodyClasses}
                  placeholder={"single-player"}
                  aria-invalid={Boolean(problems.bodyClasses)}
                  onChange={(e) => set("bodyClasses", e.target.value)}
                />
                {problems.bodyClasses ? <div className="err">{problems.bodyClasses}</div> : null}
                <div className="note">
                  One per line, as the site&rsquo;s theme puts them on the page.
                  A whole class attribute pasted in is split for you.{" "}
                  {classList.length} of {LIMITS.bodyClasses}.
                </div>
              </div>
            </div>

            <div className="field">
              <label htmlFor="pt-examples">Good examples anywhere on the web</label>
              <textarea
                id="pt-examples"
                rows={2}
                className="mono"
                spellCheck={false}
                value={form.examples}
                placeholder="https://example.com/players/some-player/"
                aria-invalid={Boolean(problems.examples)}
                onChange={(e) => set("examples", e.target.value)}
              />
              {problems.examples ? <div className="err">{problems.examples}</div> : null}
              <div className="note">
                One per line, each a whole address, for reference.{" "}
                {exampleList.length} of {LIMITS.examples}.
              </div>
            </div>
          </section>

          {/* ------------------------------------------------ facts */}
          <section className="sheet-section">
            <h3>Facts</h3>
            <p className="stage-hint">
              What the research looks for. A fact that must be verified is only
              ever stated when a source said it; otherwise the page says it is
              not confirmed. The rest are used when the sources support them.
            </p>

            {problems.facts ? <div className="err pt-list-err">{problems.facts}</div> : null}
            {form.facts.length ? (
              <ul className="pt-rows">
                {form.facts.map((fact) => {
                  const clash = keyClash(fact.uid);
                  return (
                    <li className="pt-row pt-fact" key={fact.uid}>
                      <label className="pt-cell pt-fact-label">
                        <span className="pt-cell-name">Label</span>
                        <input
                          type="text"
                          value={fact.label}
                          maxLength={LIMITS.factLabel}
                          placeholder="Date of birth"
                          onChange={(e) => setFact(fact.uid, { label: e.target.value })}
                        />
                      </label>
                      <label className="pt-cell pt-fact-key">
                        <span className="pt-cell-name">Key</span>
                        <input
                          type="text"
                          className="mono"
                          spellCheck={false}
                          // A key nobody chose shows what the label makes of it —
                          // fact_1 and so on for a label with no Latin letters —
                          // which is exactly what is saved.
                          value={fact.keyChosen ? fact.key : (keyByUid.get(fact.uid) ?? "")}
                          maxLength={LIMITS.factKey}
                          placeholder={fact.label.trim() ? "" : "made from the label"}
                          aria-invalid={Boolean(clash)}
                          onChange={(e) =>
                            setFact(fact.uid, { key: e.target.value, keyChosen: true })
                          }
                          // Tidied on the way out into the shape the engine keeps,
                          // and handed back to the label when it is emptied.
                          onBlur={() => {
                            if (!fact.keyChosen) return;
                            const typed = keyOf(fact.key);
                            if (typed !== fact.key || !typed) {
                              setFact(fact.uid, { key: typed, keyChosen: Boolean(typed) });
                            }
                          }}
                        />
                        {clash ? (
                          <span className="err">A fact above is already {clash}.</span>
                        ) : null}
                      </label>
                      <label className="pt-cell pt-fact-schema">
                        <span className="pt-cell-name">schema.org property</span>
                        <input
                          type="text"
                          className="mono"
                          spellCheck={false}
                          value={fact.schemaProperty}
                          maxLength={LIMITS.schemaProperty}
                          placeholder="birthDate"
                          onChange={(e) => setFact(fact.uid, { schemaProperty: e.target.value })}
                        />
                      </label>
                      <label className="pt-cell pt-fact-hint">
                        <span className="pt-cell-name">What counts as an answer</span>
                        <input
                          type="text"
                          value={fact.hint}
                          maxLength={LIMITS.factHint}
                          placeholder="day, month and year"
                          onChange={(e) => setFact(fact.uid, { hint: e.target.value })}
                        />
                      </label>
                      <label className="check pt-fact-verify">
                        <input
                          type="checkbox"
                          checked={fact.verify}
                          onChange={(e) => setFact(fact.uid, { verify: e.target.checked })}
                        />
                        Must be verified
                      </label>
                      <button
                        type="button"
                        className="btn btn-remove btn-sm pt-fact-drop"
                        aria-label={`Remove ${fact.label || "this fact"}`}
                        onClick={() => dropFact(fact.uid)}
                      >
                        Remove
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="quiet pt-none">
                No facts yet. A page with a facts table needs at least one.
              </p>
            )}

            <div className="pt-add">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={form.facts.length >= LIMITS.facts}
                onClick={() =>
                  change((current) =>
                    current.facts.length >= LIMITS.facts
                      ? current
                      : { ...current, facts: [...current.facts, blankFact()] },
                  )
                }
              >
                Add a fact
              </button>
              <span className="quiet">
                {form.facts.length >= LIMITS.facts
                  ? `That is the most a type can hold (${LIMITS.facts}).`
                  : `${facts.rows.length} of ${LIMITS.facts}.`}
              </span>
            </div>

            <div className="field pt-after-rows">
              <label htmlFor="pt-sources">Trusted sources</label>
              <textarea
                id="pt-sources"
                rows={3}
                className="mono"
                spellCheck={false}
                value={form.trustedSources}
                placeholder={"thehendonmob.com\nwsop.com"}
                aria-invalid={Boolean(problems.sources)}
                onChange={(e) => set("trustedSources", e.target.value)}
              />
              {problems.sources ? <div className="err">{problems.sources}</div> : null}
              <div className="note">
                One domain per line, most trusted first. The research reads
                these before anything else. {domains.length} of {LIMITS.sources}.
              </div>
            </div>
          </section>

          {/* ------------------------------------------------ outline */}
          <section className="sheet-section">
            <h3>Outline</h3>
            <p className="stage-hint">
              The sections every page of this kind has, in order. A heading may
              say {"{name}"} where the subject&rsquo;s name belongs.
            </p>

            {problems.outline ? <div className="err pt-list-err">{problems.outline}</div> : null}
            {form.outline.length ? (
              <ol className="pt-rows">
                {form.outline.map((section, at) => (
                  <li className="pt-row pt-section" key={section.uid}>
                    <span className="pt-num" aria-hidden="true">
                      {at + 1}
                    </span>
                    <label className="pt-cell pt-section-heading">
                      <span className="pt-cell-name">Heading</span>
                      <input
                        type="text"
                        value={section.heading}
                        maxLength={LIMITS.heading}
                        placeholder="Career highlights"
                        onChange={(e) => setSection(section.uid, { heading: e.target.value })}
                      />
                    </label>
                    <label className="pt-cell pt-section-guidance">
                      <span className="pt-cell-name">What it is for</span>
                      <textarea
                        rows={2}
                        value={section.guidance}
                        maxLength={LIMITS.guidance}
                        placeholder="the results and moments that define the career, in order"
                        onChange={(e) => setSection(section.uid, { guidance: e.target.value })}
                      />
                    </label>
                    <div className="pt-row-tools">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        aria-label={`Move ${section.heading || "this section"} up`}
                        title="Move up"
                        disabled={at === 0}
                        onClick={() => moveSection(at, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        aria-label={`Move ${section.heading || "this section"} down`}
                        title="Move down"
                        disabled={at === form.outline.length - 1}
                        onClick={() => moveSection(at, 1)}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="btn btn-remove btn-sm"
                        aria-label={`Remove ${section.heading || "this section"}`}
                        onClick={() => dropSection(section.uid)}
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="quiet pt-none">No sections yet. A type needs at least one.</p>
            )}

            <div className="pt-add">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={form.outline.length >= LIMITS.outline}
                onClick={() =>
                  change((current) =>
                    current.outline.length >= LIMITS.outline
                      ? current
                      : { ...current, outline: [...current.outline, blankSection()] },
                  )
                }
              >
                Add a section
              </button>
              <span className="quiet">
                {form.outline.length >= LIMITS.outline
                  ? `That is the most an outline can hold (${LIMITS.outline}).`
                  : `${form.outline.length} of ${LIMITS.outline}.`}
              </span>
            </div>
          </section>

          {/* ------------------------------------------------ writing */}
          <section className="sheet-section">
            <h3>Writing</h3>
            <p className="stage-hint">
              Plain instructions, one per line, added to the prompt that writes
              each page.
            </p>

            <div className="row-2">
              <div className="field">
                <label htmlFor="pt-rules">Writing rules</label>
                <textarea
                  id="pt-rules"
                  rows={5}
                  value={form.rules}
                  placeholder={"Write in the third person.\nGive every figure with its year."}
                  aria-invalid={Boolean(problems.rules)}
                  onChange={(e) => set("rules", e.target.value)}
                />
                {problems.rules ? <div className="err">{problems.rules}</div> : null}
                <div className="note">
                  {ruleLines.length} of {LIMITS.rules} lines, each up to {LIMITS.rule} characters.
                </div>
              </div>
              <div className="field">
                <label htmlFor="pt-avoid">Never</label>
                <textarea
                  id="pt-avoid"
                  rows={5}
                  value={form.avoid}
                  placeholder={"Invent quotes or anecdotes.\nGive gambling advice."}
                  aria-invalid={Boolean(problems.avoid)}
                  onChange={(e) => set("avoid", e.target.value)}
                />
                {problems.avoid ? <div className="err">{problems.avoid}</div> : null}
                <div className="note">
                  {avoidLines.length} of {LIMITS.rules} lines, each up to {LIMITS.rule} characters.
                </div>
              </div>
            </div>
          </section>

          {/* ------------------------------------------------ the page */}
          <section className="sheet-section">
            <h3>The page</h3>
            <p className="stage-hint">
              The shared blocks are designed once, in the engine, so every type
              that uses one gets the same look.
            </p>

            <div className="field">
              <span className="field-label">Building blocks</span>
              <div className="check-row">
                {BLOCKS.map((block) => (
                  <label className="check" key={block}>
                    <input
                      type="checkbox"
                      checked={form.blocks.includes(block)}
                      onChange={() => toggleBlock(block)}
                    />
                    {BLOCK_LABELS[block]}
                  </label>
                ))}
              </div>
            </div>

            <div className="row-2">
              <div className="field">
                <label id="pt-schema-label" htmlFor="pt-schema">
                  Schema.org type
                </label>
                <Select
                  id="pt-schema"
                  labelledBy="pt-schema-label"
                  value={form.schemaType}
                  onChange={(value) => set("schemaType", value as SchemaType)}
                  options={SCHEMA_TYPES.map((one) => ({ value: one, label: one || "None" }))}
                />
                <div className="note">Published beside the FAQ&rsquo;s, when there is one.</div>
              </div>
              <div className="field">
                <label htmlFor="pt-words">Typical length in words</label>
                <input
                  id="pt-words"
                  type="number"
                  min={0}
                  max={LIMITS.words}
                  step={50}
                  value={form.words}
                  placeholder="0"
                  aria-invalid={Boolean(problems.words)}
                  onChange={(e) => set("words", e.target.value)}
                />
                {problems.words ? (
                  <div className="err">{problems.words}</div>
                ) : (
                  <div className="note">0 lets the competing pages decide.</div>
                )}
              </div>
            </div>

            <div className="row-2">
              <div className="field">
                <label htmlFor="pt-post-type">WordPress post type</label>
                <input
                  id="pt-post-type"
                  type="text"
                  className="mono"
                  spellCheck={false}
                  value={form.postType}
                  maxLength={LIMITS.postType}
                  placeholder="page"
                  onChange={(e) => set("postType", e.target.value)}
                />
                <div className="note">Empty lets the site decide.</div>
              </div>
              <div className="field">
                <label htmlFor="pt-style-from">Copy layout from page</label>
                <input
                  id="pt-style-from"
                  type="url"
                  inputMode="url"
                  value={form.styleFrom}
                  maxLength={LIMITS.styleFrom}
                  placeholder="https://yoursite.com/players/an-existing-player/"
                  aria-invalid={Boolean(problems.styleFrom)}
                  onChange={(e) => set("styleFrom", e.target.value)}
                />
                {problems.styleFrom ? (
                  <div className="err">{problems.styleFrom}</div>
                ) : (
                  <div className="note">
                    The whole address of an existing page whose template and
                    layout new pages take.
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>

        <div className="sheet-foot">
          {blocked ? (
            <span className="err pt-foot-err">Fix what is marked above to save.</span>
          ) : null}
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void leave()}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !form.name.trim() || blocked}
            onClick={() => void save()}
          >
            {busy ? "Saving…" : form.id ? "Save changes" : "Save page type"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
