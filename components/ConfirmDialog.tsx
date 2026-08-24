"use client";

import { useEffect, useRef } from "react";

/**
 * A confirmation the app controls, rather than window.confirm, which cannot be
 * styled and renders as a browser chrome alert that looks nothing like the rest
 * of the panel.
 *
 * Built on <dialog> rather than a plain overlay div: showModal() gives focus
 * trapping, the inert backdrop and Escape handling for free, which a hand-rolled
 * overlay has to reimplement and usually gets wrong.
 */
export default function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  busyLabel,
  cancelLabel = "Keep running",
  busy = false,
  onConfirm,
  onDismiss,
}: {
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  busyLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    // Escape fires a cancel event that closes the dialog natively. Intercept it
    // so React stays the source of truth, and so it cannot close mid-request.
    const onCancelEvent = (event: Event) => {
      event.preventDefault();
      if (!busy) onDismiss();
    };

    dialog.addEventListener("cancel", onCancelEvent);
    return () => dialog.removeEventListener("cancel", onCancelEvent);
  }, [busy, onDismiss]);

  return (
    <dialog
      ref={ref}
      className="confirm"
      aria-labelledby="confirm-title"
      onClick={(event) => {
        // A click landing on the dialog element itself is the backdrop: the
        // inner wrapper covers the whole visible card.
        if (event.target === ref.current && !busy) onDismiss();
      }}
    >
      <div className="confirm-card">
        <h3 id="confirm-title" className="confirm-title">
          {title}
        </h3>
        <div className="confirm-body">{body}</div>
        <div className="confirm-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onDismiss}
            disabled={busy}
            /* The safe option takes focus, so Enter dismisses rather than
               destroys. */
            autoFocus
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? (busyLabel ?? confirmLabel) : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
