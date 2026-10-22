import type { ReportFocus } from '../../types';

const LABEL: Record<ReportFocus, string> = {
  SEO: 'Search',
  AEO: 'Answer engines',
  GEO: 'AI answers',
};

/** Visible tab name. The acronym stays on the tooltip. */
export function focusLabel(focus: ReportFocus): string {
  return LABEL[focus];
}

export function focusTip(focus: ReportFocus): string {
  return `${focus}: ${LABEL[focus]}`;
}
