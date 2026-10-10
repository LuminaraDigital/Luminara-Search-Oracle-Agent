import React, { useState } from 'react';
import { completeWeeklyMission } from '../../services/referrals/referralClient';

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
  timeEstimate: string;
  difficulty: 'Easy' | 'Medium';
  description: string;
  snippet: string;
  filename: string;
}

interface ActionableFixListProps {
  domain: string;
  findings?: ActionableFixInputFinding[];
  onFixCompleted?: (fixId: string) => void;
}

export const ActionableFixList: React.FC<ActionableFixListProps> = ({ domain, findings, onFixCompleted }) => {
  const cleanDomain = domain.replace(/^https?:\/\//i, '').replace(/\/.*$/, '') || 'yourdomain.com';
  const brandName = cleanDomain.split('.')[0] ? cleanDomain.split('.')[0].charAt(0).toUpperCase() + cleanDomain.split('.')[0].slice(1) : 'YourBrand';

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
      title: 'Deploy /llms.txt Machine-Readable Summary',
      targetEngine: 'Perplexity & ChatGPT Search',
      timeEstimate: '5 min',
      difficulty: 'Easy',
      description: 'AI answer engines prefer concise markdown at /llms.txt to accurately summarize your core offerings without hallucinations.',
      filename: '/llms.txt',
      snippet: `# ${brandName}
> ${brandName} is a leading solution for modern teams.

## Core Products & Services
- Primary Offering: Verified AI visibility, tracking, and discovery optimization.
- Target Audience: Fast-growing startups, agencies, and businesses looking to get recommended.
- Official Website: https://${cleanDomain}
- Contact & Support: https://${cleanDomain}/contact

## Key Facts
- Founded with verifiable evidence-based methodology.
- Direct integrations with modern developer and search workflows.
`,
    },
    {
      id: 'fix-schema-org',
      title: 'Inject Schema.org Organization & Service Entity Markup',
      targetEngine: 'Google AI Overviews & Knowledge Graph',
      timeEstimate: '7 min',
      difficulty: 'Easy',
      description: 'Search engines use JSON-LD entities to ground knowledge graph associations. Paste this into your website <head>.',
      filename: '<head> JSON-LD script',
      snippet: `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "${brandName}",
  "url": "https://${cleanDomain}",
  "description": "Verified business entity providing solutions for modern search and AI discovery.",
  "sameAs": [
    "https://twitter.com/${cleanDomain.split('.')[0]}",
    "https://linkedin.com/company/${cleanDomain.split('.')[0]}"
  ]
}
</script>`,
    },
    {
      id: 'fix-robots-txt',
      title: 'Allow Verified AI Engine Crawlers in robots.txt',
      targetEngine: 'GPTBot, PerplexityBot & ClaudeBot',
      timeEstimate: '3 min',
      difficulty: 'Easy',
      description: 'Ensure your robots.txt does not inadvertently block the primary AI indexing bots from crawling public pages.',
      filename: '/robots.txt',
      snippet: `# Allow primary AI search engines to crawl public content
User-agent: GPTBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: Google-Extended
Allow: /

Sitemap: https://${cleanDomain}/sitemap.xml
`,
    },
  ];

  const mappedFindings: FixItem[] = (findings || []).map((f) => ({
    id: f.id,
    title: f.title,
    targetEngine: f.targetEngine || 'AI Answer Engines & Search',
    timeEstimate: '5 min',
    difficulty: f.severity === 'critical' ? 'Medium' : 'Easy',
    description: f.description || 'Actionable finding identified in audit.',
    filename: f.filename || (f.id.includes('schema') ? 'JSON-LD <head>' : f.id.includes('llms') ? '/llms.txt' : '/robots.txt'),
    snippet: f.remediationSnippet || `// Remediation for ${f.title}\n// Apply to ${cleanDomain}`,
  }));

  const isAuditDerived = mappedFindings.length > 0;
  const activeFixes: FixItem[] = isAuditDerived ? mappedFindings : defaultFixes;

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

  return (
    <div className="mt-8 border-t border-white/10 pt-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-gold animate-pulse" />
            <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold-light">
              {isAuditDerived ? 'Audit-Derived Fix List' : 'Starter Checklist'} ({completedCount}/{activeFixes.length} Shipped)
            </h3>
          </div>
          <p className="text-xs text-gray-400 mt-1">
            {isAuditDerived
              ? `Prioritized findings from your latest audit for ${cleanDomain}.`
              : `Baseline starter checklist for ${cleanDomain}. Run an audit to generate findings-backed fixes.`}
          </p>
        </div>
        <div className="text-[11px] font-mono text-gray-500">
          Estimated total time: ~15 mins
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
                    aria-label={`Mark ${fix.title} as shipped`}
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
                  <span className="rounded-full border border-gold/20 bg-gold/5 px-2 py-0.5 text-[10px] font-mono text-gold-light">
                    {fix.timeEstimate}
                  </span>
                </div>
              </div>

              {/* Code Snippet Box */}
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
            </div>
          );
        })}
      </div>
    </div>
  );
};
