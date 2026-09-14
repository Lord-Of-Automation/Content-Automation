"use client";

import { useEffect, useRef, useState } from "react";

import type { Permission } from "@/lib/permissionlist";

/**
 * Everything one account may be allowed to do, in one sheet.
 *
 * Grouped the way the platform is, and each one says what it actually allows
 * rather than repeating its own name. "Buy domains" is obvious; what somebody
 * granting it needs to know is that it charges a card with no approval step
 * and no undo, and that sentence is the whole reason this is a dialog rather
 * than a row of unlabelled switches.
 *
 * The ones that spend money, reach a stranger or cannot be undone are marked.
 * Nothing stops you granting them — this is a list of people you already
 * trusted enough to give an account — but a list where everything looks the
 * same is a list where the dangerous ones get granted by accident.
 *
 * Built on <dialog> and showModal, like every other sheet here: focus
 * trapping, an inert backdrop and Escape are the browser's to get right, and
 * a hand-rolled overlay gets one of the three wrong.
 */

export default function PermissionsDialog({
  user,
  granted,
  catalogue,
  onClose,
  onSaved,
}: {
  user: string;
  granted: string[];
  catalogue: Permission[];
  onClose: () => void;
  /** Hands back what the server says each account may do now. */
  onSaved: (permissions: Record<string, string[]>) => void;
}) {
  const shell = useRef<HTMLDialogElement>(null);

  const [chosen, setChosen] = useState<Set<string>>(new Set(granted));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = shell.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();

    const onCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    dialog.addEventListener("cancel", onCancel);
    return () => dialog.removeEventListener("cancel", onCancel);
  }, [onClose]);

  const groups: Array<[string, Permission[]]> = [];
  for (const one of catalogue) {
    const found = groups.find(([name]) => name === one.group);
    if (found) found[1].push(one);
    else groups.push([one.group, [one]]);
  }

  function toggle(id: string) {
    setChosen((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    setBusy(true);
    try {
      const response = await fetch("/api/accounts", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user, permissions: [...chosen] }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "That could not be saved.");
      onSaved(payload.permissions ?? {});
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  const heavy = [...chosen].filter(
    (id) => catalogue.find((one) => one.id === id)?.weighty,
  ).length;

  return (
    <dialog className="sheet perms" ref={shell}>
      <div className="sheet-card">
        <div className="sheet-head">
          <div>
            <h2>What {user} can do</h2>
            <p>
              {chosen.size} of {catalogue.length} granted
              {heavy ? `, ${heavy} of them weighty` : ""}. Changes apply the
              next time they load a page.
            </p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="sheet-body">
          {error ? <div className="notice bad">{error}</div> : null}

          {groups.map(([name, rows]) => (
            <section className="perm-group" key={name}>
              <h3>{name}</h3>
              {rows.map((one) => (
                <label
                  className={one.weighty ? "perm is-weighty" : "perm"}
                  key={one.id}
                  htmlFor={`perm-${one.id}`}
                >
                  <input
                    id={`perm-${one.id}`}
                    type="checkbox"
                    checked={chosen.has(one.id)}
                    disabled={busy}
                    onChange={() => toggle(one.id)}
                  />
                  <span className="perm-what">
                    <strong>
                      {one.label}
                      {one.weighty ? <span className="perm-flag">weighty</span> : null}
                    </strong>
                    <span className="perm-note">{one.note}</span>
                  </span>
                </label>
              ))}
            </section>
          ))}

          {/* Both ends, because the two things somebody comes here to do are
              "give this person everything" and "stop this person doing
              anything at all". */}
          <div className="perm-both">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={() => setChosen(new Set(catalogue.map((one) => one.id)))}
            >
              Grant everything
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={() => setChosen(new Set())}
            >
              Take everything away
            </button>
          </div>
        </div>

        <div className="sheet-foot">
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save permissions"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
