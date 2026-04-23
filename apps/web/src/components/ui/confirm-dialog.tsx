"use client";

import { Button } from "@keyflow/ui";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: "danger" | "default";
};

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  variant = "default",
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title" aria-describedby="confirm-dialog-desc">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onCancel}
        role="button"
        aria-label="Close dialog"
      />
      <div className="relative z-10 w-full max-w-md mx-4 rounded-xl border border-border/60 bg-slate-900/95 backdrop-blur-xl p-6 shadow-2xl">
        <h3 className="text-lg font-semibold mb-2" id="confirm-dialog-title">{title}</h3>
        <p className="text-sm text-muted-foreground mb-6" id="confirm-dialog-desc">{message}</p>
        <div className="flex justify-end gap-2">
          <Button variant="subtle" onClick={onCancel} autoFocus>
            {cancelLabel}
          </Button>
          <Button
            onClick={onConfirm}
            className={
              variant === "danger"
                ? "bg-red-600 hover:bg-red-700 text-white"
                : undefined
            }
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
