import React, { isValidElement, type ReactNode } from 'react';

/**
 * Honest empty-state copy for audit panels. Never invent metrics:
 * a missing PSI result is 'not measured', a missing GSC link is 'not connected'.
 */

export const PSI_EMPTY_COPY =
  'PageSpeed not measured for this URL yet. Run a fresh audit with a public URL to fetch it.';

export const GSC_EMPTY_COPY =
  'Search Console is not connected. Connect it in Settings to see real query and click data.';

const tagClass = 'text-[10px] font-mono px-2 py-0.5 rounded-full border border-white/10 text-gray-500';

export const PsiNotMeasuredTag: React.FC = () => <span className={tagClass}>not_measured</span>;

export const GscNotConfiguredTag: React.FC = () => <span className={tagClass}>not_configured</span>;

export const PsiEmptyState: React.FC = () => (
  <div className="flex items-start justify-between gap-2">
    <p className="text-[11px] text-gray-500">{PSI_EMPTY_COPY}</p>
    <PsiNotMeasuredTag />
  </div>
);

export const GscEmptyState: React.FC = () => (
  <div className="flex items-start justify-between gap-2">
    <p className="text-[11px] text-gray-500">{GSC_EMPTY_COPY}</p>
    <GscNotConfiguredTag />
  </div>
);

/** Branch-selection predicates used by the audit panels (null data => empty state). */
export const showPsiEmptyState = (metrics: unknown | null): boolean => metrics == null;
export const showGscEmptyState = (summary: unknown | null): boolean => summary == null;

/** Flatten all text inside a React subtree, evaluating function components. Test-only aid. */
export function collectText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(collectText).join('');
  if (isValidElement(node)) {
    const { type, props } = node as React.ReactElement<{ children?: ReactNode }>;
    const fromChildren = collectText(props.children);
    if (typeof type === 'function') {
      const rendered = (type as React.FC)(props) as unknown;
      if (rendered instanceof Promise) return '';
      return collectText(rendered as ReactNode);
    }
    return fromChildren;
  }
  return '';
}
