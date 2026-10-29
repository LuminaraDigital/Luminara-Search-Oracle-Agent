import React, { useState } from 'react';
import { completeWeeklyMission } from '../../services/referrals/referralClient';
import { brandNameFor } from '../../services/audit/brandName';
import { plainCustomerReport } from '../../services/audit/reportColumnGate';
import { comparisonOutlineDraft, llmsTxtDraft, organizationJsonLd } from '../../services/audit/fixPackCopy';
import { ANSWER_CRAWLER_BOTS } from '../../services/audit/llmCrawlerReadiness';
import { starterFixContradictsPass } from '../../services/audit/teaserFailureCodes';

export interface ActionableFixInputFinding {
  id: string;
  title: string;
  category?: string;
  severity?: string;
  description?: string;
  remediationSnippet?: string;
  targetEngine?: string;
  filename?: string;
}

interface FixItem {
  id: string;
  title: string;
  targetEngine: string;
  description: string;
  snippet: string;
  filename: string;
}

interface ActionableFixListProps {
  domain: string;
  findings?: ActionableFixInputFinding[];
  crawlerChecks?: readonly { id: string; status: string }[];
  /** Page title and description. Used only to fill an llms.txt draft. */
  pageTitle?: string | null;
  pageDescription?: string | null;
  onFixCompleted?: (fixId: string) => void;
}

function commentOnly(snippet: string): boolean {
  const lines = snippet.split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.length > 0 && lines.every((line) => line.startsWith('//'));
}

function llmsDraft(domain: string, title?: string | null, description?: string | null): string {
  const siteName = brandNameFor(domain, title);
  const about = (description || '').replace(/\s+/g, ' ').trim();
  if (!siteName && !about) return '';
  return llmsTxtDraft(domain, { siteName, description: about || null });
}

function snippetFor(finding: ActionableFixInputFinding, domain: string, pageTitle?: string | null, pageDescription?: string | null): string {
  const given = (finding.remediationSnippet || '').trim();
  const blob = `${finding.id} ${finding.title} ${finding.filename || ''}`;
  if (/llms/i.test(blob) && (!given || commentOnly(given))) return llmsDraft(domain, pageTitle, pageDescription);
  if (/\b(compare|comparison|versus|citation[- ]gap)\b/i.test(blob) && (!given || commentOnly(given))) {
    const siteName = brandNameFor(domain, pageTitle);
    const description = (pageDescription || '').replace(/\s+/g, ' ').trim() || null;
    return comparisonOutlineDraft(domain, { siteName, description });
  }
  if (given && !commentOnly(given)) return given;
  return '';
}

export const ActionableFixList: React.FC<ActionableFixListProps> = ({ domain, findings, crawlerChecks, pageTitle, pageDescription, onFixCompleted }) => {
  const cleanDomain = domain.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/^www\./i, '') || 'yourdomain.com';

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [completedFixes, setCompletedFixes] = useState<Record<string, boolean>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const stored = localStorage.getItem(`luminara_fixes_${cleanDomain}`);
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });

  const defaultFixes: FixItem[] = [
    {
      id: 'fix-llms-txt',
      title: 'Add a short page at /llms.txt',
      targetEngine: 'A page on your site',
      description: 'Add /llms.txt with a short summary of what you sell and how buyers can book or enquire. The file is a hint, not a score.',
      filename: '/llms.txt',
      snippet: llmsTxtDraft(domain),
    },
    {
      id: 'fix-schema-org',
      title: 'Add a business identity tag',
      targetEngine: 'A tag in the page header',
      description: 'Add a business identity tag in the page header so the page names the business and its contact URL. Paste the block below.',
      filename: 'Page header script',
      snippet: `<script type="application/ld+json">\n${organizationJsonLd(domain)}\n</script>`,
    },
    {
      id: 'fix-robots-txt',
      title: 'Let crawlers read public pages in robots.txt',
      targetEngine: 'Crawler rules in robots.txt',
      description: 'If robots.txt blocks an AI answer crawler, that crawler may not read public pages or suburb guides. The lines below name the answer crawlers to allow. Training opt-outs such as GPTBot can stay as they are.',
      filename: '/robots.txt',
      snippet: `# Allow AI answer crawlers to read public pages
${ANSWER_CRAWLER_BOTS.map((bot) => `User-agent: ${bot}`).join('\n')}
Allow: /

Sitemap: https://${cleanDomain}/sitemap.xml
`,
    },
  ];

  const mappedFindings: FixItem[] = (findings || []).map((f) => ({
    id: f.id,
    title: plainCustomerReport(f.title),
    targetEngine: f.targetEngine || 'This website',
    description: f.description || 'A check in this audit failed. The note below is the repair.',
    filename: f.filename || (
      /schema/i.test(`${f.id} ${f.title}`) ? 'Page header script'
        : /llms/i.test(`${f.id} ${f.title}`) ? '/llms.txt'
          : /robots/i.test(`${f.id} ${f.title}`) ? '/robots.txt'
            : (!f.remediationSnippet?.trim() || commentOnly(f.remediationSnippet.trim())) && /\b(compare|comparison|versus|citation[- ]gap)\b/i.test(`${f.id} ${f.title}`) ? '/compare/outline.md'
              : 'notes.txt'
    ),
    snippet: snippetFor(f, cleanDomain, pageTitle, pageDescription),
  }));

  const measuredRun = Array.isArray(findings);
  const activeFixes: FixItem[] = (measuredRun ? mappedFindings : defaultFixes)
    .filter((fix) => !starterFixContradictsPass(`${fix.id} ${fix.title}`, crawlerChecks));
  const isAuditDerived = measuredRun;

  const handleCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2500);
    } catch {
      // ignore
    }
  };

  const toggleComplete = (id: string) => {
    setCompletedFixes((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem(`luminara_fixes_${cleanDomain}`, JSON.stringify(next));
      } catch {
        // ignore
      }
      if (next[id]) {
        completeWeeklyMission('checklist_fix').catch(() => {});
        if (onFixCompleted) {
          onFixCompleted(id);
        }
      }
      return next;
    });
  };

  const completedCount = Object.values(completedFixes).filter(Boolean).length;
  if (activeFixes.length === 0 && (measuredRun || Boolean(crawlerChecks?.length))) {
    return (
      <div className="mt-8 border-t border-white/10 pt-6">
        <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold-light">Starter checklist</h3>
        <p className="mt-2 text-sm text-gray-300">No starter fixes. This run did not record a failed check to repair.</p>
      </div>
    );
  }

  return (
    <div className="mt-8 border-t border-white/10 pt-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-gold animate-pulse" />
            <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold-light">
              {isAuditDerived ? 'Fixes from this audit' : 'Starter checklist'} ({completedCount} of {activeFixes.length} fixes done)
            </h3>
          </div>
          <p className="text-xs text-gray-400 mt-1">
            {isAuditDerived
              ? `Fixes from the latest audit of ${cleanDomain}.`
              : `Starter checklist for ${cleanDomain}. Run an audit for fixes from a real check.`}
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {activeFixes.map((fix) => {
          const isDone = Boolean(completedFixes[fix.id]);
          return (
            <div
              key={fix.id}
              className={`rounded-xl border transition-all p-4 ${
                isDone
                  ? 'border-gold/30 bg-gold/[0.04]'
                  : 'border-white/10 bg-white/[0.02]'
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 mb-2">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={isDone}
                    onChange={() => toggleComplete(fix.id)}
                    className="mt-1 h-4 w-4 rounded border-white/20 bg-black text-gold focus:ring-gold"
                    aria-label={`Mark ${fix.title} done`}
                  />
                  <div>
                    <h4 className={`text-sm font-semibold ${isDone ? 'text-gold-light line-through' : 'text-white'}`}>
                      {fix.title}
                    </h4>
                    <p className="text-xs text-gray-400 mt-0.5">{fix.description}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto pl-7 sm:pl-0">
                  <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-mono text-gray-300">
                    {fix.targetEngine}
                  </span>
                </div>
              </div>

              {fix.snippet.trim() && (
              <div className="mt-3 pl-7">
                <div className="flex items-center justify-between bg-black/60 rounded-t-lg px-3 py-1.5 border-t border-x border-white/10 text-[10px] font-mono text-gray-400">
                  <span>{fix.filename}</span>
                  <button
                    type="button"
                    onClick={() => void handleCopy(fix.id, fix.snippet)}
                    className="text-gold-light hover:text-white transition-colors uppercase font-bold tracking-wider"
                  >
                    {copiedId === fix.id ? 'Copied to Clipboard!' : 'Copy Code'}
                  </button>
                </div>
                <pre className="text-[11px] font-mono text-gray-300 bg-black/40 rounded-b-lg p-3 border border-white/10 overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-40">
                  {fix.snippet}
                </pre>
              </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
