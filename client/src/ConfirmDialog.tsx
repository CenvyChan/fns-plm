import { useWorkspacePortal } from './WorkspacePortal'
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import "./confirm-dialog.css";

type Props = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  busy?: boolean;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "确认删除",
  busy = false,
  danger = true,
  onConfirm,
  onCancel,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { portalHost, tabActive } = useWorkspacePortal();
  const id = useId();
  useEffect(() => {
    const node = dialog.current;
    if (!open || !tabActive || !node) return;
    const active =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!node.open) node.showModal();
    return () => {
      node.close();
      document.body.style.overflow = previousOverflow;
      active?.focus();
    };
  }, [open, tabActive]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <dialog
      ref={dialog}
      className="app-confirm-dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div className="app-confirm-content">
        <h2 id={`${id}-title`}>{title}</h2>
        <p id={`${id}-description`}>{description}</p>
        <div className="app-confirm-actions">
          <button type="button" autoFocus disabled={busy} onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className={danger ? "danger" : "primary"}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "正在处理…" : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>,
    portalHost!,
  );
}
