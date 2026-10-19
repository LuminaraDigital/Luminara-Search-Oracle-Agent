const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function canFocus(value: EventTarget | Element | null): value is HTMLElement {
  if (!value || typeof value !== 'object') return false;
  const el = value as HTMLElement;
  return typeof el.focus === 'function' && typeof el.contains === 'function';
}

export interface DialogFrame {
  dialog: HTMLElement;
  trigger: HTMLElement | null;
  /** True once the dialog's text field has taken focus, so later edits do not steal it. */
  settled: boolean;
}

export interface DialogFocusState {
  frames: DialogFrame[];
}

export function createDialogFocusState(): DialogFocusState {
  return { frames: [] };
}

function shown(el: HTMLElement): boolean {
  if (typeof el.getAttribute === 'function' && el.getAttribute('aria-hidden') === 'true') return false;
  if (el.hidden) return false;
  if (typeof el.getClientRects === 'function' && el.getClientRects().length === 0) return false;
  return true;
}

export function listFocusable(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.tabIndex >= 0 && shown(el));
}

function openDialogs(doc: Document): HTMLElement[] {
  return Array.from(doc.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'));
}

const FIELD = 'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([disabled]), textarea:not([disabled]), select:not([disabled])';

function preferredField(dialog: HTMLElement): HTMLElement | null {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FIELD)).find(shown) ?? null;
}

export function preferredFocus(dialog: HTMLElement): HTMLElement | null {
  return preferredField(dialog) ?? listFocusable(dialog)[0] ?? null;
}

function closer(dialog: HTMLElement): HTMLElement | null {
  const named = dialog.querySelector<HTMLElement>('button[aria-label*="close" i], button[aria-label*="cancel" i]');
  if (named) return named;
  return listFocusable(dialog).find((el) => /^(close|cancel|dismiss)$/i.test((el.textContent || '').trim())) ?? null;
}

function triggerFor(doc: Document, dialog: HTMLElement, fallback: HTMLElement | null): HTMLElement | null {
  const prev = doc.activeElement;
  if (canFocus(prev) && prev !== doc.body && !dialog.contains(prev)) return prev;
  if (fallback && fallback.isConnected && !dialog.contains(fallback)) return fallback;
  return null;
}

/** Move focus into a new dialog, and back to the control that opened it when it closes. */
export function syncDialogFocus(doc: Document, state: DialogFocusState, fallback: HTMLElement | null = null): void {
  const live = new Set(openDialogs(doc));
  const closed: DialogFrame[] = [];
  state.frames = state.frames.filter((frame) => {
    if (live.has(frame.dialog)) return true;
    closed.push(frame);
    return false;
  });
  if (closed.length > 0) {
    const back = [...closed].reverse().find((frame) => frame.trigger?.isConnected)?.trigger;
    const parent = state.frames[state.frames.length - 1];
    if (back) back.focus();
    else if (parent) preferredFocus(parent.dialog)?.focus();
  }
  for (const dialog of live) {
    let frame = state.frames.find((item) => item.dialog === dialog);
    const created = !frame;
    if (!frame) {
      frame = { dialog, trigger: triggerFor(doc, dialog, fallback), settled: false };
      state.frames.push(frame);
    }
    if (frame.settled) continue;
    const field = preferredField(dialog);
    if (field) {
      frame.settled = true;
      if (doc.activeElement !== field) field.focus();
    } else if (created) {
      listFocusable(dialog)[0]?.focus();
    }
  }
}

/**
 * Trap Tab in the top dialog. Escape clicks its close control when it has one,
 * and leaves the event alone when the dialog closes itself another way.
 */
export function onDialogKey(doc: Document, event: KeyboardEvent): void {
  const dialog = openDialogs(doc).at(-1);
  if (!dialog) return;
  if (event.key === 'Escape') {
    const close = closer(dialog);
    if (!close) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    close.click();
    return;
  }
  if (event.key !== 'Tab') return;
  const items = listFocusable(dialog);
  if (items.length === 0) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = doc.activeElement;
  const outside = !canFocus(active) || !dialog.contains(active);
  if (event.shiftKey && (active === first || outside)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    last.focus();
  } else if (!event.shiftKey && (active === last || outside)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    first.focus();
  }
}

export function installDialogFocus(doc: Document = document): () => void {
  const state = createDialogFocusState();
  let pending: HTMLElement | null = null;
  const remember = (event: FocusEvent) => {
    if (openDialogs(doc).length > 0) return;
    if (canFocus(event.target) && event.target !== doc.body) pending = event.target;
  };
  const sync = () => syncDialogFocus(doc, state, pending);
  const onKey = (event: KeyboardEvent) => onDialogKey(doc, event);
  doc.addEventListener('focusin', remember, true);
  doc.addEventListener('keydown', onKey, true);
  const observer = new MutationObserver(sync);
  if (doc.body) observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['role', 'aria-modal'] });
  sync();
  return () => {
    doc.removeEventListener('focusin', remember, true);
    doc.removeEventListener('keydown', onKey, true);
    observer.disconnect();
  };
}
