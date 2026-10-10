/**
 * Atomic SEO gut-checks over filtered measured fields. Missing => not_measured.
 */
import type { AtomicDimension, ClaimStatus } from './types';

export type PageEvidence = {
  url?: string;
  title?: string;
  text?: string;
  robotsAllow?: boolean | null;
  hasLlmsTxt?: boolean | null;
  hasFaqControl?: boolean | null;
  researchLogHit?: boolean | null;
  projectGoal?: string | null;
};

function dim(
  id: string,
  label: string,
  value: number | null,
  status: ClaimStatus,
  note?: string,
): AtomicDimension {
  return { id, label, value, status, ...(note ? { note } : {}) };
}

/**
 * Independent dimensions. Never invents Live ranks or traffic numbers.
 */
export function runAtomicChecks(evidence: PageEvidence): AtomicDimension[] {
  const dims: AtomicDimension[] = [];

  if (evidence.robotsAllow == null) {
    dims.push(dim('indexability', 'Crawl/index signals', null, 'not_measured', 'robotsAllow unknown'));
  } else {
    dims.push(
      dim(
        'indexability',
        'Crawl/index signals',
        evidence.robotsAllow ? 1 : 0,
        'measured',
        evidence.robotsAllow ? 'robots allow' : 'robots disallow',
      ),
    );
  }

  if (evidence.hasLlmsTxt == null) {
    dims.push(dim('llm_crawler', 'llms.txt / AI crawler files', null, 'not_measured'));
  } else {
    dims.push(
      dim('llm_crawler', 'llms.txt / AI crawler files', evidence.hasLlmsTxt ? 1 : 0.2, 'measured'),
    );
  }

  const goal = (evidence.projectGoal || '').trim().toLowerCase();
  const blob = `${evidence.title || ''} ${evidence.text || ''}`.toLowerCase();
  if (!goal) {
    dims.push(dim('intent_match', 'Primary intent vs project goal', null, 'not_measured', 'no project goal'));
  } else if (!blob.trim()) {
    dims.push(dim('intent_match', 'Primary intent vs project goal', null, 'not_measured', 'no page text'));
  } else {
    const tokens = goal.split(/[^a-z0-9]+/).filter((t) => t.length > 3);
    const hits = tokens.filter((t) => blob.includes(t));
    const ratio = tokens.length ? hits.length / tokens.length : 0;
    dims.push(
      dim('intent_match', 'Primary intent vs project goal', Math.min(1, ratio), 'estimated', 'lexical overlap only'),
    );
  }

  if (evidence.hasFaqControl == null) {
    dims.push(dim('interactive_faq', 'FAQ/accordion control in observe', null, 'not_measured'));
  } else {
    dims.push(
      dim('interactive_faq', 'FAQ/accordion control in observe', evidence.hasFaqControl ? 1 : 0, 'measured'),
    );
  }

  if (evidence.researchLogHit == null) {
    dims.push(dim('research_fresh', 'Research log hit within 30 days', null, 'not_measured'));
  } else {
    dims.push(
      dim(
        'research_fresh',
        'Research log hit within 30 days',
        evidence.researchLogHit ? 1 : 0,
        'measured',
      ),
    );
  }

  return dims;
}
