import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Button } from './Button';

export interface ConfirmModalProps {
  open: boolean;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'default';
  onConfirm: () => void;
  onCancel: () => void;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible confirmation dialog. Focus is trapped inside the dialog, Escape and
 * backdrop clicks cancel, and initial focus lands on the Cancel button so an
 * accidental Enter never confirms a destructive action.
 */
export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
  onCancel,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    // Initial focus on Cancel (safe default).
    const raf = requestAnimationFrame(() => cancelRef.current?.focus());

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Swallow it so parent overlays (Settings, Omnibar) don't also close.
        e.stopImmediatePropagation();
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const nodes = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (nodes.length === 0) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || !dialogRef.current.contains(active))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', handleKey, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', handleKey, true);
      previouslyFocused?.focus?.();
    };
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] overflow-y-auto flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200"
      onMouseDown={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className={`glass-morphism rounded-2xl shadow-2xl w-full max-w-md my-auto overflow-hidden bg-black/95 animate-in zoom-in-95 duration-200 ${
          variant === 'danger' ? 'border border-danger-500/40' : 'border border-gold/40'
        }`}
      >
        <div className={`px-6 py-4 border-b ${variant === 'danger' ? 'bg-gradient-to-r from-danger-500/15 to-transparent border-danger-500/20' : 'bg-gradient-to-r from-gold/20 to-transparent border-gold/20'}`}>
          <h3 id={titleId} className={`text-sm font-bold uppercase tracking-widest ${variant === 'danger' ? 'text-danger-300' : 'text-gold-light'}`}>
            {title}
          </h3>
        </div>
        {description && (
          <div id={descId} className="px-6 py-4 text-xs text-gray-300 leading-relaxed">
            {description}
          </div>
        )}
        <div className="px-6 py-4 border-t border-white/5 bg-black/40 flex items-center justify-end gap-3">
          <Button ref={cancelRef} type="button" variant="ghost" size="sm" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button type="button" variant={variant === 'danger' ? 'danger' : 'primary'} size="sm" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
};

export type ConfirmOptions = Omit<ConfirmModalProps, 'open' | 'onConfirm' | 'onCancel'>;

/**
 * Minimal wiring helper:
 *   const { requestConfirm, confirmModal } = useConfirm();
 *   requestConfirm({ title: 'Delete?', variant: 'danger' }, () => doDelete());
 *   ... {confirmModal}
 */
export function useConfirm() {
  const [state, setState] = useState<(ConfirmOptions & { onConfirm: () => void }) | null>(null);

  const requestConfirm = useCallback((options: ConfirmOptions, onConfirm: () => void) => {
    setState({ ...options, onConfirm });
  }, []);

  const close = useCallback(() => setState(null), []);

  const confirmModal = (
    <ConfirmModal
      open={state !== null}
      title={state?.title ?? ''}
      description={state?.description}
      confirmLabel={state?.confirmLabel}
      cancelLabel={state?.cancelLabel}
      variant={state?.variant}
      onCancel={close}
      onConfirm={() => {
        const action = state?.onConfirm;
        setState(null);
        action?.();
      }}
    />
  );

  return { requestConfirm, confirmModal, isOpen: state !== null };
}
