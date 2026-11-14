"use client";

import { useEffect, useRef } from "react";

// Native <dialog> gives focus trapping, Esc-to-close and inert background.
export default function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  tone = "default",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  tone?: "default" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      className="m-auto w-[min(92vw,420px)] rounded-lg border border-[#26344a] bg-[#0e1725] p-0 text-sm text-zinc-300 shadow-2xl backdrop:bg-black/60"
      aria-labelledby="ef-dialog-title"
    >
      {open && (
        <div className="p-5">
          <h2 id="ef-dialog-title" className="text-base font-semibold text-white">
            {title}
          </h2>
          <div className="mt-2 text-xs leading-relaxed text-zinc-400">{children}</div>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="ef-btn" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="button"
              autoFocus
              className={tone === "danger" ? "ef-btn ef-btn-danger" : "ef-btn ef-btn-primary"}
              onClick={onConfirm}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
