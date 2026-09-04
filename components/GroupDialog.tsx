"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Select } from "@/components/Select";

type Group = { id: string; name: string; domains: string[] };

/**
 * Putting the selected domains into a named group.
 *
 * Appending, never replacing. Choosing a group of two hundred and pressing this
 * with three domains selected has to mean "add these three" — the other reading
 * turns a menu called Group into an act of deletion, and nobody would guess
 * that from the word.
 *
 * The dropdown is the whole interaction: pick a group to append to, or pick New
 * group and name one. Typing the name of a group that already exists adds to
 * it, rather than making a second group with the same name that nobody could
 * tell apart afterwards.
 */
export default function GroupDialog({
  domains,
  onClose,
  onSaved,
}: {
  domains: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [choice, setChoice] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const shell = useRef<HTMLDialogElement>(null);

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

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/domaingroups", { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as { groups?: Group[] };
      setGroups(payload.groups ?? []);
    } catch {
      // A group list that will not load still leaves naming a new one, which
      // is the half that does not need it.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(remove: boolean) {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const response = await fetch("/api/domaingroups", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: choice || undefined,
          name: choice ? undefined : name,
          domains,
          remove,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "That did not work.");

      setGroups(payload.groups ?? []);
      setDone(
        remove
          ? `Removed ${payload.already} from ${payload.name}.`
          : `Added ${payload.added} to ${payload.name}` +
            (payload.already ? `, ${payload.already} were already in it.` : "."),
      );
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  const chosen = groups.find((g) => g.id === choice);
  const canSave = choice ? true : name.trim().length > 0;

  return (
    <dialog className="sheet sheet-narrow" ref={shell}>
      <div className="sheet-card">
        <div className="sheet-head">
          <div>
            <h2>Group</h2>
            <p>
              {domains.length} domain{domains.length === 1 ? "" : "s"} selected
            </p>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="sheet-body">
          {error ? <div className="notice bad">{error}</div> : null}
          {done ? <div className="notice ok">{done}</div> : null}

          <section className="sheet-section">
            <div className="field">
              <label id="group-choice-label" htmlFor="group-choice">
                Group
              </label>
              <Select
                id="group-choice"
                labelledBy="group-choice-label"
                value={choice}
                onChange={setChoice}
                options={[
                  { value: "", label: "New group…" },
                  ...groups.map((g) => ({
                    value: g.id,
                    label: g.name,
                    hint: `${g.domains.length}`,
                  })),
                ]}
              />
              <div className="note">
                Adding to a group never removes what is already in it.
              </div>
            </div>

            {!choice ? (
              <div className="field">
                <label htmlFor="group-name">Name</label>
                <input
                  id="group-name"
                  type="text"
                  placeholder="Donbet brand, UK server, Q4 launches"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && canSave && !busy) void save(false);
                  }}
                />
                <div className="note">
                  A name you will recognise in a year. Typing one that already
                  exists adds to that group rather than making a second with the
                  same name.
                </div>
              </div>
            ) : null}

            <div className="sheet-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !canSave}
                onClick={() => void save(false)}
              >
                {busy ? "Saving…" : choice ? `Add to ${chosen?.name ?? "group"}` : "Create and add"}
              </button>

              {/* Only for a group that exists. Taking domains out of a group
                  being named in the box above is not a thing that can happen. */}
              {choice ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={busy}
                  onClick={() => void save(true)}
                >
                  Remove from it instead
                </button>
              ) : null}
            </div>
          </section>

          {groups.length ? (
            <section className="sheet-section">
              <h3>Groups</h3>
              <table className="logs logs-middle">
                <tbody>
                  {groups.map((g) => (
                    <tr key={g.id}>
                      <td>{g.name}</td>
                      <td className="mid">{g.domains.length}</td>
                      <td className="detail">
                        {/* How much of the current selection is already in it,
                            which is the thing you want to know before pressing
                            a button that says Add. */}
                        {(() => {
                          const inIt = domains.filter((d) => g.domains.includes(d)).length;
                          return inIt ? (
                            <span className="quiet">
                              {inIt} of the {domains.length} selected already here
                            </span>
                          ) : null;
                        })()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}
        </div>
      </div>
    </dialog>
  );
}
