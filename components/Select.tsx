"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

/**
 * A select whose list is ours rather than the operating system's.
 *
 * A native <select> takes styling on the closed control and none at all on the
 * open list: that popup is drawn by the OS, in the OS's font, ignoring the
 * theme. On a dark page the market list came up white. This draws the list too,
 * so both halves match the rest of the form.
 *
 * The trade is that everything a native select does for free has to be done
 * here. It follows the ARIA combobox pattern: focus stays on the control the
 * whole time and the active option is pointed at with aria-activedescendant,
 * rather than moving focus into the list and having to put it back.
 *
 * ---
 *
 * A long list gets a search box. Type-to-jump is enough for a dozen markets and
 * useless for three hundred and sixty-nine hosted applications, where the thing
 * you know about the one you want is rarely the letter it starts with — it is a
 * word from the middle of its name, or its domain, or which host it is on.
 *
 * Filtering appears on its own once a list is long enough to need it, rather
 * than being something each caller remembers to ask for. A caller may still
 * insist either way.
 */

export interface SelectOption {
  value: string;
  label: string;
  /** Shown muted after the label. The market code, or a domain, in practice. */
  hint?: string;
  /**
   * Matched by the search but never drawn.
   *
   * What somebody searches by is not always what there is room to show. A
   * hosted application is worth finding by the server it sits on, and putting
   * the server in the hint as well would leave a line too long to read for the
   * sake of a word most people never type.
   */
  search?: string;
}

/**
 * Where a list stops being scannable.
 *
 * Around a dozen is a list you read; beyond that it is one you search. The
 * exact number matters less than that the box appears before somebody starts
 * scrolling to find things.
 */
const SEARCH_FROM = 12;

/** Every term has to appear somewhere in the option, in any order. */
export function matches(option: SelectOption, terms: string[]): boolean {
  if (!terms.length) return true;
  const hay = `${option.label} ${option.hint ?? ""} ${option.search ?? ""}`.toLowerCase();
  return terms.every((term) => hay.includes(term));
}

export function Select({
  id,
  value,
  options,
  onChange,
  labelledBy,
  invalid,
  searchable,
  searchPlaceholder,
}: {
  id: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  labelledBy?: string;
  invalid?: boolean;
  /** Defaults to on for a list too long to scan. */
  searchable?: boolean;
  searchPlaceholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [query, setQuery] = useState("");

  const wrap = useRef<HTMLDivElement | null>(null);
  const list = useRef<HTMLUListElement | null>(null);
  const button = useRef<HTMLButtonElement | null>(null);
  const search = useRef<HTMLInputElement | null>(null);

  // Letters typed in quick succession jump to a matching option, the way a
  // native select does. Cleared after a pause so "ge" then "ge" is two hunts,
  // not one for "gege". Only used when there is no search box.
  const typed = useRef("");
  const typedAt = useRef(0);

  const listId = useId();
  const hunting = searchable ?? options.length > SEARCH_FROM;

  /** What the list is showing, which is not what it holds once filtered. */
  const shown = useMemo(() => {
    if (!hunting) return options;
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return options.filter((option) => matches(option, terms));
  }, [options, query, hunting]);

  const current = options.find((o) => o.value === value);

  function openList() {
    setQuery("");
    const at = options.findIndex((o) => o.value === value);
    setActive(at >= 0 ? at : 0);
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setQuery("");
    button.current?.focus();
  }

  function choose(index: number) {
    const option = shown[index];
    if (option) onChange(option.value);
    close();
  }

  // Closing on an outside press is what makes it feel like a menu rather than a
  // panel. Pointerdown, not click: a click that starts outside and ends inside
  // should still close it.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    }
    function onBlur() {
      setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("blur", onBlur);
    };
  }, [open]);

  // Typing goes into the box, so it has to be where the cursor is.
  useEffect(() => {
    if (open && hunting) search.current?.focus();
  }, [open, hunting]);

  /*
   * Filtering moves the ground under the highlight.
   *
   * While there is something typed, the top of what is left is the answer:
   * the row somebody was pointing at may not be in the list any more. With the
   * box empty the list is whole again, so it points at whatever is chosen,
   * which is where an untouched dropdown should open.
   */
  useEffect(() => {
    if (!open) return;
    if (query) {
      setActive(0);
      return;
    }
    const at = options.findIndex((o) => o.value === value);
    setActive(at >= 0 ? at : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // The list scrolls, so the active option has to be brought into view or
  // arrowing past the fold moves an invisible highlight.
  useEffect(() => {
    if (!open) return;
    const node = list.current?.children[active] as HTMLElement | undefined;
    node?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function typeahead(key: string) {
    const now = Date.now();
    typed.current = now - typedAt.current > 700 ? key : typed.current + key;
    typedAt.current = now;

    const found = options.findIndex((o) =>
      o.label.toLowerCase().startsWith(typed.current),
    );
    if (found < 0) return;
    if (open) setActive(found);
    else choose(found);
  }

  /** Arrowing and choosing, shared by the button and the search box. */
  function navigate(event: React.KeyboardEvent): boolean {
    const key = event.key;

    if (key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, shown.length - 1));
    } else if (key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (key === "Home") {
      event.preventDefault();
      setActive(0);
    } else if (key === "End") {
      event.preventDefault();
      setActive(shown.length - 1);
    } else if (key === "Enter") {
      event.preventDefault();
      choose(active);
    } else if (key === "Tab") {
      setOpen(false);
    } else {
      return false;
    }
    return true;
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const key = event.key;

    if (key === "Escape") {
      if (!open) return;
      event.preventDefault();
      close();
      return;
    }

    if (!open) {
      if (key === "ArrowDown" || key === "ArrowUp" || key === "Enter" || key === " ") {
        event.preventDefault();
        openList();
      } else if (key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        if (hunting) {
          // The letter that opened the list is the first letter of the search,
          // so nothing typed is thrown away.
          openList();
          setQuery(key);
        } else {
          typeahead(key.toLowerCase());
        }
      }
      return;
    }

    if (navigate(event)) return;

    if (key === " " && !hunting) {
      event.preventDefault();
      choose(active);
    } else if (
      !hunting &&
      key.length === 1 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      event.preventDefault();
      typeahead(key.toLowerCase());
    }
  }

  return (
    <div className="select" ref={wrap}>
      <button
        id={id}
        ref={button}
        type="button"
        role="combobox"
        className="select-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-labelledby={labelledBy ? `${labelledBy} ${id}` : undefined}
        aria-activedescendant={open && !hunting ? `${listId}-${active}` : undefined}
        aria-invalid={invalid || undefined}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
      >
        <span className="select-value">
          {current ? current.label : ""}
          {current?.hint ? <span className="select-hint">{current.hint}</span> : null}
        </span>
        <span className="select-arrow" aria-hidden="true" />
      </button>

      {open ? (
        <div className="select-popup">
          {hunting ? (
            <div className="select-search">
              <input
                ref={search}
                type="text"
                role="combobox"
                className="select-search-input"
                placeholder={searchPlaceholder ?? "Search"}
                value={query}
                autoComplete="off"
                spellCheck={false}
                aria-controls={listId}
                aria-expanded
                aria-activedescendant={shown.length ? `${listId}-${active}` : undefined}
                aria-label="Search the list"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    close();
                    return;
                  }
                  navigate(event);
                }}
              />
              <span className="select-count">
                {query ? `${shown.length} of ${options.length}` : `${options.length}`}
              </span>
            </div>
          ) : null}

          <ul className="select-list" id={listId} role="listbox" ref={list} tabIndex={-1}>
            {shown.map((option, index) => (
              <li
                key={option.value}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={option.value === value}
                className={
                  "select-option" +
                  (index === active ? " is-active" : "") +
                  (option.value === value ? " is-selected" : "")
                }
                // Mouse down would blur the control and close the list before
                // the click ever lands, so the choice is made on pointer down.
                onPointerDown={(event) => {
                  event.preventDefault();
                  choose(index);
                }}
                onPointerEnter={() => setActive(index)}
              >
                <span className="select-option-label">{option.label}</span>
                {option.hint ? <span className="select-hint">{option.hint}</span> : null}
              </li>
            ))}

            {hunting && !shown.length ? (
              <li className="select-empty">Nothing matches {query}</li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
