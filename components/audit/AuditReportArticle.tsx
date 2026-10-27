import React, { useEffect, useState } from 'react';
import type { BoardFinding } from '../../services/audit/findingBoardService';
import { pickPrimaryFinding, setFindingStatusLocal } from '../../services/audit/findingBoardService';
import { AUDIT_ACTIVITY_EVENT } from '../../services/audit/auditActivity';
import { diffSince } from '../../services/audit/auditDiffService';
import { workspaceHistoryReady } from '../../services/sync/workspaceSyncService';
import { visibleGroundingSources } from '../../services/audit/unmeasuredClaimGuard';
import { parseMeasuredCheckLine } from '../../services/agentCore/auditEvidenceGate';
import { customerSourceLine, sourceReadKind } from '../../services/audit/reportColumnGate';
import { formatAuDate } from '../../utils/formatAuDate';
import { isWebUrl } from '../../utils/webUrl';
import {
  checkFixTitle,
  displayMeasured,
  groundCustomerReport,
  NOT_MEASURED,
  findingFix,
  findingWhy,
  fixProgress,
  isDowngradedFinding,
  parseAuditReport,
  progressSince,
  recheckLabel,
  reportScore,
  SAVED_AUDIT_CHECK_COPY,
  showFixTally,
  unmeasuredNote,
  type Inline,
  type ReportBlock,
  type ReportSection,
} from '../../services/audit/reportBlocks';
import { ReportPdfButton } from './ReportPdfButton';
import { CompetitorMap } from './CompetitorMap';
import { VisibilityRadar } from './VisibilityRadar';

const SEVERITY = {
  critical: 'border-red-300/40 bg-red-950 text-red-100',
  high: 'border-amber-200/40 bg-amber-950 text-amber-100',
  medium: 'border-white/20 bg-white/10 text-gray-100',
  low: 'border-white/15 bg-white/5 text-gray-200',
} as const;

const SAME_SITE = 'https://same-site.invalid';

function safeHref(href: string): string | null {
  if (isWebUrl(href) || href.startsWith('mailto:')) return href;
  // A path opens in this window, so it must resolve to this site: "//host" and "/\host" do not.
  try {
    return href.startsWith('/') && new URL(href, SAME_SITE).origin === SAME_SITE ? href : null;
  } catch {
    return null;
  }
}

function InlineRun({ items }: { items: Inline[] }) {
  return (
    <>
      {items.map((item, index) => {
        if (item.kind === 'strong') return <strong key={index} className="font-semibold text-white">{item.text}</strong>;
        if (item.kind === 'em') return <em key={index}>{item.text}</em>;
        if (item.kind === 'code') return <code key={index} className="rounded bg-white/10 px-1 py-0.5 text-[0.9em] text-gray-100">{item.text}</code>;
        if (item.kind === 'link') {
          const href = safeHref(item.href);
          return href ? (
            <a key={index} href={href} className="text-gold-light underline underline-offset-2 hover:text-white" target={href.startsWith('/') ? undefined : '_blank'} rel={href.startsWith('/') ? undefined : 'noopener noreferrer'}>{item.text}</a>
          ) : <span key={index}>{item.text}</span>;
        }
        return <span key={index}>{item.text}</span>;
      })}
    </>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        const write = navigator.clipboard?.writeText(text);
        if (!write) return;
        void write.then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        }).catch(() => setCopied(false));
      }}
      className="min-h-11 shrink-0 px-2 text-sm text-gold-light underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function CodeBlock({ text }: { text: string }) {
  return (
    <div className="my-4 overflow-hidden rounded-xl border border-white/15 bg-black">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <p className="text-xs font-semibold text-gray-300">Snippet</p>
        <CopyButton text={text} />
      </div>
      <pre className="overflow-x-auto p-4 text-sm leading-relaxed text-gray-100"><code>{text}</code></pre>
    </div>
  );
}

/** Numbers live here, not in the model headings. The same list is 1 to 7 on every path. */
const REPORT_HEADINGS: ReadonlyArray<{ test: RegExp; title: string }> = [
  { test: /one move/i, title: '1. One move this week' },
  { test: /plain verdict/i, title: '2. Plain verdict' },
  { test: /fix list/i, title: '3. Fix list' },
  { test: /visibility radar/i, title: '4. Visibility radar' },
  { test: /competitor/i, title: '5. Competitor map' },
  { test: /budget/i, title: '6. Budget notes' },
];

const SOURCES_TITLE = '7. Sources';

function sectionSlug(title: string): string {
  const words = title.replace(/^\d+\.\s*/, '');
  return words.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';
}

function withoutDate(blocks: ReportBlock[]): ReportBlock[] {
  return blocks.filter((block) => block.kind !== 'paragraph' || !/^\**\s*Date:/i.test(block.text.trim()));
}

function customerSections(sections: ReportSection[]): ReportSection[] {
  const used = new Set<number>();
  const known = REPORT_HEADINGS.map((item) => {
    const index = sections.findIndex((section, i) => !used.has(i) && item.test.test(section.title));
    if (index >= 0) used.add(index);
    const found = index >= 0 ? sections[index] : undefined;
    return { id: sectionSlug(item.title), title: item.title, blocks: withoutDate(found?.blocks || []) };
  });
  const extra = sections.flatMap((section, index) => {
    if (used.has(index) || /\bsources\b/i.test(section.title)) return [];
    const blocks = withoutDate(section.blocks);
    return blocks.length ? [{ ...section, blocks }] : [];
  });
  return [...known, ...extra];
}

function BlockView({
  block,
  sectionTitle,
  evidence,
}: {
  block: ReportBlock;
  sectionTitle: string;
  evidence?: ReadonlyArray<{ query: string; brandCited: boolean }>;
}) {
  if (block.kind === 'heading') {
    const Tag = block.level <= 3 ? 'h3' : 'h4';
    return <Tag id={block.id} className="mt-6 text-lg font-semibold text-white">{block.text}</Tag>;
  }
  if (block.kind === 'paragraph') return <p className="my-3 text-base leading-relaxed text-gray-200"><InlineRun items={block.inlines} /></p>;
  if (block.kind === 'quote') return <blockquote className="my-4 border-l-2 border-gold/60 pl-4 text-base leading-relaxed text-gray-200">{block.text}</blockquote>;
  if (block.kind === 'list') {
    const Tag = block.ordered ? 'ol' : 'ul';
    return (
      <Tag className={`my-3 space-y-2 pl-5 text-base leading-relaxed text-gray-200 ${block.ordered ? 'list-decimal' : 'list-disc'}`}>
        {block.items.map((item, index) => <li key={index}><InlineRun items={item} /></li>)}
      </Tag>
    );
  }
  if (block.kind === 'code') return <CodeBlock text={block.text} />;
  if (block.kind === 'table') {
    const title = sectionTitle.toLowerCase();
    if (title.includes('visibility radar')) return <VisibilityRadar headers={block.headers} rows={block.rows} evidence={evidence} />;
    if (title.includes('competitor')) return <CompetitorMap headers={block.headers} rows={block.rows} />;
    return (
      <div className="my-4 overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm text-gray-100">
          <thead>
            <tr>
              {block.headers.map((header) => (
                <th key={header} scope="col" className="border border-white/20 bg-white/10 px-3 py-2 font-semibold text-white">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, index) => (
              <tr key={index}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="border border-white/15 px-3 py-2 align-top">{displayMeasured(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  const _exhaustive: never = block;
  return _exhaustive;
}

export function AuditReportArticle({
  markdown,
  measured,
  findings,
  domain,
  clientName,
  sources,
  showActions = true,
  citationRateKnown,
  checkLine,
  citationEvidence,
  citationLine,
  auditedAt,
  mode = 'Instant Audit',
  onShare,
  onFindings,
}: {
  markdown: string;
  measured: boolean;
  findings: BoardFinding[];
  domain?: string;
  clientName?: string;
  sources?: Array<{ uri: string; title: string }>;
  showActions?: boolean;
  /** True when this run counted search mentions. Omit when citation was not in play. */
  citationRateKnown?: boolean;
  /** Checklist sentence already shown on the page-health card. */
  checkLine?: string;
  /** Queries the search evidence actually measured. The radar prints these, not a model guess. */
  citationEvidence?: ReadonlyArray<{ query: string; brandCited: boolean; intent?: string; competitorsCited?: string[] }>;
  /** Sentence already built from mentionCounts. Omitted when citation was not measured. */
  citationLine?: string | null;
  auditedAt?: number | Date;
  mode?: string;
  onShare?: () => void;
  onFindings?: (findings: BoardFinding[]) => void;
}) {
  const [historyRevision, setHistoryRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setHistoryRevision((n) => n + 1);
    window.addEventListener('luminara-workspace-restored', refresh);
    window.addEventListener(AUDIT_ACTIVITY_EVENT, refresh);
    return () => {
      window.removeEventListener('luminara-workspace-restored', refresh);
      window.removeEventListener(AUDIT_ACTIVITY_EVENT, refresh);
    };
  }, []);
  const shown = domain
    ? groundCustomerReport(markdown, {
        domain,
        brand: clientName,
        findings,
        evidence: citationEvidence,
        citationLine,
        auditedAt,
        mode,
      })
    : markdown;
  const doc = parseAuditReport(shown, { domain, brand: clientName });
  const score = reportScore(`${markdown}\n${doc.verdict}`, measured, findings, citationRateKnown, checkLine);
  const fixes = findings.filter((finding) => !isDowngradedFinding(finding));
  const note = unmeasuredNote(findings);
  const progress = fixProgress(fixes);
  const next = pickPrimaryFinding(fixes);
  const diff = domain ? diffSince(domain) : { before: null, metrics: [] };
  // Re-read after a workspace pull. The number itself is only a refresh signal.
  void historyRevision;
  const since = !workspaceHistoryReady() && !diff.before
    ? SAVED_AUDIT_CHECK_COPY
    : progressSince({ ...diff, checks: parseMeasuredCheckLine(score) });
  const tally = showFixTally(score);
  const validSources = visibleGroundingSources(sources, { domain, brand: clientName }) || [];
  const plain = doc.sections.find((section) => /plain verdict/i.test(section.title));
  const plainBlock = plain?.blocks.find((block) => block.kind === 'paragraph');
  const verdict = (plainBlock && plainBlock.kind === 'paragraph' ? plainBlock.text : '') || doc.verdict || 'Not measured.';
  const dated = formatAuDate(auditedAt ?? Date.now());
  const sections = customerSections(doc.sections);

  const mark = (finding: BoardFinding, done: boolean) => {
    const nextFindings = setFindingStatusLocal(domain || finding.domain, findings, finding.id, done ? 'done' : 'open');
    onFindings?.(nextFindings);
  };

  return (
    <div className="mb-8 lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:items-start lg:gap-8">
      <nav aria-label="Report sections" className="mb-4 hidden lg:block">
        <div className="sticky top-4 rounded-xl border border-white/10 bg-black/80 p-3">
          <p className="px-2 text-xs font-semibold tracking-wide text-gray-300">On this page</p>
          <ul className="mt-2 space-y-1">
            <li><a href="#audit-score" className="block min-h-11 rounded-lg px-2 py-2 text-sm text-gray-200 hover:bg-white/5 hover:text-white">Score</a></li>
            <li><a href="#audit-fixes" className="block min-h-11 rounded-lg px-2 py-2 text-sm text-gray-200 hover:bg-white/5 hover:text-white">Fixes</a></li>
            {sections.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`} className="block min-h-11 rounded-lg px-2 py-2 text-sm text-gray-200 hover:bg-white/5 hover:text-white">{section.title}</a>
              </li>
            ))}
            {validSources.length > 0 && (
              <li>
                <a href="#audit-sources" className="block min-h-11 rounded-lg px-2 py-2 text-sm text-gray-200 hover:bg-white/5 hover:text-white">{SOURCES_TITLE}</a>
              </li>
            )}
          </ul>
        </div>
      </nav>

      <article className="min-w-0 max-w-[70ch]">
        <header id="audit-score" className="rounded-2xl border border-white/15 bg-white/5 px-5 py-6">
          <p className="text-xs font-semibold tracking-wide text-gold-light">Score</p>
          <h2 className="mt-2 font-serif-editorial text-4xl leading-tight text-white">{score}</h2>
          <p className="mt-3 max-w-[70ch] text-base leading-relaxed text-gray-100">{verdict}</p>
          {dated ? <p className="mt-4 text-sm text-gray-200">Date: {dated} · Mode: {mode}</p> : null}
          <p className="mt-4 text-sm text-gray-200">{tally ? progress.label : 'The score above is the only pass count for the site checks.'}</p>
          {tally && (
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={Math.max(progress.total, 1)}
              aria-valuenow={progress.done}
              aria-valuetext={progress.label}
              className="mt-2 h-2 overflow-hidden rounded-full bg-white/10"
            >
              <div className="h-full bg-gold motion-reduce:transition-none" style={{ width: progress.total ? `${Math.round((progress.done / progress.total) * 100)}%` : '0%' }} />
            </div>
          )}
          <p className="mt-4 text-sm text-gray-200">{recheckLabel()}</p>
          <p className="mt-2 text-sm text-gray-200">{since}</p>
          {showActions && (
            <div className="mt-5 flex flex-wrap items-center gap-2">
              {onShare && (
                <button type="button" onClick={onShare} className="min-h-11 rounded-lg bg-gold px-4 text-sm font-semibold text-black hover:bg-gold-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold">
                  Share
                </button>
              )}
              <ReportPdfButton
                markdownText={markdown}
                domain={domain}
                clientName={clientName}
                measured={measured}
                findings={findings}
              />
            </div>
          )}
        </header>

        <section id="audit-fixes" aria-label="Fixes" className="mt-6 space-y-3">
          <h2 className="text-xl font-semibold text-white">Fixes</h2>
          {fixes.length === 0 && <p className="text-base leading-relaxed text-gray-200">No fixes were recorded for this audit.</p>}
          {fixes.map((finding) => {
            const why = findingWhy(finding);
            const fix = findingFix(finding, why);
            const chip = SEVERITY[finding.severity] || SEVERITY.low;
            const isNext = next?.id === finding.id && finding.status !== 'done';
            return (
              <article key={finding.id} className={`rounded-2xl border bg-black px-4 py-4 ${isNext ? 'border-gold' : 'border-white/15'}`}>
                {isNext && <p className="text-xs font-semibold tracking-wide text-gold-light">Your next fix</p>}
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-semibold text-white">{checkFixTitle(finding.id, finding.title)}</h3>
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${chip}`}>{finding.severity}</span>
                </div>
                <p className="mt-3 text-xs font-semibold tracking-wide text-gray-300">Why it matters for buyers and vendors</p>
                <p className="mt-1 text-base leading-relaxed text-gray-100">{why}</p>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold tracking-wide text-gray-300">How to fix</p>
                  <CopyButton text={fix} />
                </div>
                <p className="text-base leading-relaxed text-gray-100">{fix}</p>
                <label className="mt-3 flex min-h-11 items-center gap-3 text-sm text-gray-100">
                  <input
                    type="checkbox"
                    checked={finding.status === 'done'}
                    onChange={(event) => mark(finding, event.target.checked)}
                    className="h-4 w-4 accent-gold"
                  />
                  Mark done
                </label>
              </article>
            );
          })}
          {note && <p className="text-base leading-relaxed text-gray-200">{note}</p>}
        </section>

        {sections.map((section) => (
          <section key={section.id} id={section.id} className="mt-6 border-t border-white/10 pt-4">
            <details open className="group">
              <summary className="cursor-pointer list-none text-xl font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold [&::-webkit-details-marker]:hidden">
                {section.title}
              </summary>
              <div className="mt-2">
                {section.blocks.length ? section.blocks.map((block, index) => (
                  <BlockView key={`${section.id}-${index}`} block={block} sectionTitle={section.title} evidence={citationEvidence || undefined} />
                )) : <p className="my-3 text-base leading-relaxed text-gray-200">{NOT_MEASURED}.</p>}
              </div>
            </details>
          </section>
        ))}

        {validSources.length > 0 && (
          <section id="audit-sources" className="mt-8 border-t border-white/10 pt-4">
            <h2 className="text-xl font-semibold text-white">{SOURCES_TITLE}</h2>
            <ul className="mt-3 space-y-2">
              {validSources.map((source) => (
                <li key={source.uri}>
                  <a href={source.uri} target="_blank" rel="noopener noreferrer" className="text-base text-gold-light underline underline-offset-2 hover:text-white">{customerSourceLine(source.uri, source.title || '', sourceReadKind(source.uri, domain))}</a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </article>
    </div>
  );
}
