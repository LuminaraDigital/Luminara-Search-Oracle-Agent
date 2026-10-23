import React, { isValidElement, type ReactNode } from 'react';

/**
 * Honest empty-state copy for audit panels. Never invent metrics:
 * a missing PSI result is 'not measured', a missing GSC link is 'not connected'.
 */

export const PSI_EMPTY_COPY =
  'PageSpeed is not measured yet. Click Measure to fetch it for this URL.';

export const GSC_EMPTY_COPY =
  'Search Console is not connected. Connect it in Settings to see real query and click data.';

export const PsiEmptyState: React.FC = () => (
  <p className="text-[11px] text-gray-500">{PSI_EMPTY_COPY}</p>
);

export const GscEmptyState: React.FC = () => (
  <p className="text-[11px] text-gray-500">{GSC_EMPTY_COPY}</p>
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
