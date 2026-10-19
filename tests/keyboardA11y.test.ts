import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { globeKeepsSpinning } from '../components/marketing/earth/globeRenderer';
import {
  createDialogFocusState,
  onDialogKey,
  syncDialogFocus,
} from '../services/a11y/dialogFocus';

type Fake = {
  tag: string;
  attrs: Record<string, string>;
  children: Fake[];
  text: string;
  tabIndex: number;
  isConnected: boolean;
  clicked: boolean;
  focus: () => void;
  click: () => void;
  contains: (other: Fake) => boolean;
  querySelector: (sel: string) => Fake | null;
  querySelectorAll: (sel: string) => Fake[];
};

function flatten(node: Fake): Fake[] {
  return [node, ...node.children.flatMap(flatten)];
}

function make(tag: string, attrs: Record<string, string> = {}, text = ''): Fake {
  const node = {
    tag,
    attrs,
    children: [] as Fake[],
    text,
    tabIndex: attrs.tabindex === '-1' ? -1 : 0,
    isConnected: true,
    clicked: false,
  } as Fake;
  node.focus = () => { doc.activeElement = node; };
  node.click = () => { node.clicked = true; };
  node.contains = (other) => flatten(node).includes(other);
  node.querySelectorAll = (sel) => flatten(node).filter((el) => matches(el, sel));
  node.querySelector = (sel) => node.querySelectorAll(sel)[0] ?? null;
  return node;
}

function matches(el: Fake, sel: string): boolean {
  if (sel.includes('role="dialog"')) return el.attrs.role === 'dialog' && el.attrs['aria-modal'] === 'true';
  if (sel.startsWith('input')) return el.tag === 'input' && el.attrs.type !== 'hidden';
  if (sel.includes('aria-label*="close"')) return el.tag === 'button' && /close|cancel/i.test(el.attrs['aria-label'] || '');
  if (sel.includes('button:not')) return el.tag === 'button' || el.tag === 'input' || (el.tag === 'a' && 'href' in el.attrs);
  return false;
}

const doc = {
  body: make('body'),
  activeElement: null as Fake | null,
  querySelectorAll(sel: string) {
    return flatten(doc.body).filter((el) => matches(el, sel));
  },
};

function key(partial: Partial<KeyboardEvent> & { key: string }): KeyboardEvent {
  return {
    preventDefault() {},
    stopImmediatePropagation() {},
    shiftKey: false,
    ...partial,
  } as KeyboardEvent;
}

describe('dialog focus', () => {
  it('moves into the dialog, traps Tab, closes on Escape, and restores the trigger', () => {
    const trigger = make('button', {}, 'See payment options');
    const close = make('button', { 'aria-label': 'Close dialog' }, 'x');
    const pay = make('button', {}, 'Pay');
    const email = make('input', { type: 'email' });
    const dialog = make('div', { role: 'dialog', 'aria-modal': 'true' });
    dialog.children.push(close, email, pay);
    doc.body.children = [trigger, dialog];
    doc.activeElement = trigger;

    const state = createDialogFocusState();
    syncDialogFocus(doc as unknown as Document, state);
    expect(doc.activeElement).toBe(email);

    doc.activeElement = pay;
    onDialogKey(doc as unknown as Document, key({ key: 'Tab' }));
    expect(doc.activeElement).toBe(close);

    onDialogKey(doc as unknown as Document, key({ key: 'Escape' }));
    expect(close.clicked).toBe(true);

    doc.body.children = [trigger];
    syncDialogFocus(doc as unknown as Document, state);
    expect(doc.activeElement).toBe(trigger);
  });

  it('returns to the outer trigger when a stacked dialog closes with it', () => {
    const trigger = make('button', {}, 'See payment options');
    const innerTrigger = make('button', {}, 'Confirm');
    const parent = make('div', { role: 'dialog', 'aria-modal': 'true' });
    const child = make('div', { role: 'dialog', 'aria-modal': 'true' });
    parent.children.push(make('button', { 'aria-label': 'Close dialog' }, 'x'), innerTrigger);
    child.children.push(make('button', { 'aria-label': 'Cancel' }, 'Cancel'));
    doc.body.children = [trigger, parent];
    doc.activeElement = trigger;

    const state = createDialogFocusState();
    syncDialogFocus(doc as unknown as Document, state);

    doc.body.children = [trigger, parent, child];
    doc.activeElement = innerTrigger;
    syncDialogFocus(doc as unknown as Document, state);
    expect(doc.activeElement).toBe(child.children[0]);

    innerTrigger.isConnected = false;
    doc.body.children = [trigger];
    syncDialogFocus(doc as unknown as Document, state);
    expect(doc.activeElement).toBe(trigger);
  });
});

describe('skip link and reduced motion', () => {
  it('offers a skip link to #main on the shells', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).toContain('class="skip-link" href="#main"');
    expect(html).toContain('.skip-link:focus');
    for (const file of [
      'components/LandingPage.tsx',
      'components/marketing/MarketingPageShell.tsx',
      'components/NotFoundPage.tsx',
      'components/LegalPage.tsx',
      'components/audit/SharedReportView.tsx',
      'App.tsx',
    ]) {
      expect(readFileSync(file, 'utf8'), file).toContain('id="main"');
    }
  });

  it('stops looping motion when the visitor asks for less', () => {
    expect(globeKeepsSpinning(true)).toBe(false);
    expect(globeKeepsSpinning(false)).toBe(true);
    const css = readFileSync('index.css', 'utf8');
    const rule = css.slice(css.indexOf('prefers-reduced-motion'));
    expect(rule).toContain('animation-iteration-count: 1 !important');
    expect(readFileSync('components/marketing/earth/globeRenderer.ts', 'utf8')).toContain('if (!globeKeepsSpinning(opts.reducedMotion))');
  });
});
