import React, { useState } from 'react';
import type { BoardFinding } from '../../services/audit/findingBoardService';
import { pickPrimaryFinding, setFindingStatusLocal } from '../../services/audit/findingBoardService';
import { diffSince } from '../../services/audit/auditDiffService';
import { visibleGroundingSources } from '../../services/audit/unmeasuredClaimGuard';
import {
  findingFix,
  findingWhy,
  fixProgress,
  isDowngradedFinding,
  parseAuditReport,
  progressSince,
  recheckLabel,
  scoreLine,
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

function safeHref(href: string): string | null {
  if (/^https?:\/\//i.test(href) || href.startsWith('mailto:') || href.startsWith('/')) return href;
  return null;
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

function visibleSections(sections: ReportSection[], verdict: string): ReportSection[] {
  return sections.flatMap((section) => {
    const blocks = section.blocks.filter((block) => {
      if (block.kind !== 'paragraph' && block.kind !== 'quote') return true;
      return block.text !== verdict;
    });
    return blocks.length ? [{ ...section, blocks }] : [];
  });
}

function BlockView({ block, sectionTitle }: { block: ReportBlock; sectionTitle: string }) {
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
    if (title.includes('visibility radar')) return <VisibilityRadar headers={block.headers} rows={block.rows} />;
    if (title.includes('competitor reality map')) return <CompetitorMap headers={block.headers} rows={block.rows} />;
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
                  <td key={cellIndex} className="border border-white/15 px-3 py-2 align-top">{cell || 'Not measured'}</td>
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
  onShare?: () => void;
  onFindings?: (findings: BoardFinding[]) => void;
}) {
  const doc = parseAuditReport(markdown);
  const score = scoreLine(`${markdown}\n${doc.verdict}`, measured);
  const fixes = findings.filter((finding) => !isDowngradedFinding(finding));
  const note = unmeasuredNote(findings);
  const progress = fixProgress(fixes);
  const next = pickPrimaryFinding(fixes);
  const since = progressSince(domain ? diffSince(domain) : { before: null, metrics: [] });
  const validSources = visibleGroundingSources(sources) || [];
  const verdict = doc.verdict || 'Not measured.';
  const sections = visibleSections(doc.sections, verdict);

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
          </ul>
        </div>
      </nav>

      <article className="min-w-0 max-w-[70ch]">
        <header id="audit-score" className="rounded-2xl border border-white/15 bg-white/5 px-5 py-6">
          <p className="text-xs font-semibold tracking-wide text-gold-light">Score</p>
          <h2 className="mt-2 font-serif-editorial text-4xl leading-tight text-white">{score}</h2>
          <p className="mt-3 max-w-[70ch] text-base leading-relaxed text-gray-100">{verdict}</p>
          <p className="mt-4 text-sm text-gray-200">{progress.label}</p>
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
                  <h3 className="text-lg font-semibold text-white">{finding.title}</h3>
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
                {section.blocks.map((block, index) => <BlockView key={`${section.id}-${index}`} block={block} sectionTitle={section.title} />)}
              </div>
            </details>
          </section>
        ))}

        {validSources.length > 0 && (
          <section className="mt-8 border-t border-white/10 pt-4">
            <h2 className="text-xl font-semibold text-white">Sources</h2>
            <ul className="mt-3 space-y-2">
              {validSources.map((source) => (
                <li key={source.uri}>
                  <a href={source.uri} target="_blank" rel="noopener noreferrer" className="text-base text-gold-light underline underline-offset-2 hover:text-white">{source.title || source.uri}</a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </article>
    </div>
  );
}
