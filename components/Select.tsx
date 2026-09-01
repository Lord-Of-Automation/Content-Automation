"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * A select whose list is ours rather than the operating system's.
 *
 * A native <select> takes styling on the closed control and none at all on the
 * open list: that popup is drawn by the OS, in the OS's font, ignoring the
 * theme. On a dark page the market list came up white. This draws the list too,
 * so both halves match the rest of the form.
 *
 * The trade is that everything a native select does for free has to be done
 * here. It follows the ARIA combobox pattern: focus stays on the button the
 * whole time and the active option is pointed at with aria-activedescendant,
 * rather than moving focus into the list and having to put it back.
 */

export interface SelectOption {
  value: string;
  label: string;
  /** Shown muted after the label. The market code, in practice. */
  hint?: string;
}

export function Select({
  id,
  value,
  options,
  onChange,
  labelledBy,
  invalid,
}: {
  id: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  labelledBy?: string;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const wrap = useRef<HTMLDivElement | null>(null);
  const list = useRef<HTMLUListElement | null>(null);
  const button = useRef<HTMLButtonElement | null>(null);

  // Letters typed in quick succession jump to a matching option, the way a
  // native select does. Cleared after a pause so "ge" then "ge" is two hunts,
  // not one for "gege".
  const typed = useRef("");
  const typedAt = useRef(0);

  const listId = useId();
  const selected = options.findIndex((o) => o.value === value);
  const current = selected >= 0 ? options[selected] : undefined;

  function openList() {
    setActive(selected >= 0 ? selected : 0);
    setOpen(true);
  }

  function choose(index: number) {
    const option = options[index];
    if (option) onChange(option.value);
    setOpen(false);
    button.current?.focus();
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

  function onKeyDown(event: React.KeyboardEvent) {
    const key = event.key;

    if (key === "Escape") {
      if (!open) return;
      event.preventDefault();
      setOpen(false);
      return;
    }

    if (!open) {
      if (key === "ArrowDown" || key === "ArrowUp" || key === "Enter" || key === " ") {
        event.preventDefault();
        openList();
      } else if (key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        typeahead(key.toLowerCase());
      }
      return;
    }

    if (key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, options.length - 1));
    } else if (key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (key === "Home") {
      event.preventDefault();
      setActive(0);
    } else if (key === "End") {
      event.preventDefault();
      setActive(options.length - 1);
    } else if (key === "Enter" || key === " ") {
      event.preventDefault();
      choose(active);
    } else if (key === "Tab") {
      setOpen(false);
    } else if (key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
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
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        aria-invalid={invalid || undefined}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
      >
        <span className="select-value">
          {current ? current.label : ""}
          {current?.hint ? <span className="select-hint">{current.hint}</span> : null}
        </span>
        <span className="select-arrow" aria-hidden="true" />
      </button>

      {open ? (
        <ul className="select-list" id={listId} role="listbox" ref={list} tabIndex={-1}>
          {options.map((option, index) => (
            <li
              key={option.value}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === selected}
              className={
                "select-option" +
                (index === active ? " is-active" : "") +
                (index === selected ? " is-selected" : "")
              }
              // Mouse down would blur the button and close the list before the
              // click ever lands, so the choice is made on pointer down.
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
        </ul>
      ) : null}
    </div>
  );
}
