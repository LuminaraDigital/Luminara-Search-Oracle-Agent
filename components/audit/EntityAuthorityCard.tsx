import React from 'react';
import { ICONS } from '../../constants';
import { EnrichedEntityIntelligence } from '../../services/enrichment/publicApisEnrichmentService';

interface EntityAuthorityCardProps {
  enriched?: EnrichedEntityIntelligence | null;
}

export const EntityAuthorityCard: React.FC<EntityAuthorityCardProps> = ({ enriched }) => {
  if (!enriched) return null;

  const { wikidata, wayback, security, sameAsUrls, domain, brandName } = enriched;

  return (
    <div className="my-6 glass-morphism rounded-2xl border border-gold/40 p-5 bg-gradient-to-br from-black via-black/90 to-black/80 shadow-2xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-gold/10 border border-gold/30 text-gold-light">
            <ICONS.Network className="w-5 h-5 text-gold-light" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              Entity Authority & Knowledge Graph Grounding
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-success-500/20 text-success-300 border border-success-500/30">
                Open APIs Verified
              </span>
            </h3>
            <p className="text-xs text-gray-400">
              Authority signals from Wikidata, Internet Archive, and HTTP Security Observatories.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-gray-500 uppercase">Security Trust:</span>
          <span className="text-xs font-bold font-mono text-success-400">
            {security.trustScore}/100
          </span>
          <span
            className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
              security.measurementConfidence === 'full'
                ? 'border-success-500/40 text-success-300'
                : security.measurementConfidence === 'cors_limited'
                  ? 'border-warning-500/40 text-warning-300'
                  : 'border-danger-500/40 text-danger-300'
            }`}
          >
            {security.measurementConfidence}
          </span>
        </div>
      </div>

      {/* Grid of Key Trust Signals */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-4">
        
        {/* Signal 1: Canonical Wikidata Resolution */}
        <div className="glass-morphism rounded-xl p-3.5 border border-white/10 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-[10px] font-mono text-gray-400 uppercase tracking-wider mb-1.5">
              <span>Wikidata Knowledge Graph</span>
              <span className={`px-1.5 py-0.5 rounded ${wikidata ? 'bg-success-500/20 text-success-300' : 'bg-white/5 text-gray-400'}`}>
                {wikidata ? 'Resolved' : 'Local Node'}
              </span>
            </div>
            {wikidata ? (
              <div>
                <a
                  href={wikidata.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-bold text-cyan-300 hover:underline flex items-center gap-1"
                >
                  <span>{wikidata.id} &bull; {wikidata.label}</span>
                  <ICONS.ExternalLink className="w-3 h-3 shrink-0" />
                </a>
                <p className="text-[11px] text-gray-400 mt-1 line-clamp-2 leading-snug">
                  {wikidata.description || 'Canonical entity record in Wikimedia Knowledge Base.'}
                </p>
              </div>
            ) : (
              <div>
                <span className="text-xs font-bold text-gray-200">{brandName}</span>
                <p className="text-[11px] text-gray-500 mt-1 leading-snug">
                  Target candidate for new Wikidata item creation and Knowledge Graph anchoring.
                </p>
              </div>
            )}
          </div>

          <div className="mt-2.5 pt-2 border-t border-white/5 text-[10px] text-gray-500 font-mono">
            {wikidata ? '✓ Canonical entity QID active' : '⚡ Enhanced via Schema.org @id'}
          </div>
        </div>

        {/* Signal 2: Internet Archive Wayback Longevity */}
        <div className="glass-morphism rounded-xl p-3.5 border border-white/10 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-[10px] font-mono text-gray-400 uppercase tracking-wider mb-1.5">
              <span>Domain Historical Longevity</span>
              <span className={`px-1.5 py-0.5 rounded ${wayback.hasArchive ? 'bg-success-500/20 text-success-300' : 'bg-white/5 text-gray-400'}`}>
                {wayback.status.replace('_', ' ').toUpperCase()}
              </span>
            </div>

            {wayback.hasArchive ? (
              <div>
                <div className="text-xs font-bold text-white">
                  Indexed since {wayback.earliestDate}
                </div>
                <p className="text-[11px] text-gray-400 mt-1 leading-snug">
                  {wayback.archivedYearsAgo} years continuous archive history. Strong E-E-A-T domain age factor.
                </p>
              </div>
            ) : (
              <div>
                <div className="text-xs font-bold text-gray-300">Modern / Newly Indexed</div>
                <p className="text-[11px] text-gray-500 mt-1 leading-snug">
                  Recent digital footprint. Schema.org entity grounding recommended to build instant authority.
                </p>
              </div>
            )}
          </div>

          {wayback.snapshotUrl && (
            <div className="mt-2.5 pt-2 border-t border-white/5">
              <a
                href={wayback.snapshotUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] font-mono text-gold-light hover:underline flex items-center gap-1"
              >
                <span>Earliest Archive Snapshot</span>
                <ICONS.ExternalLink className="w-2.5 h-2.5" />
              </a>
            </div>
          )}
        </div>

        {/* Signal 3: Security & HTTPS Baseline */}
        <div className="glass-morphism rounded-xl p-3.5 border border-white/10 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-[10px] font-mono text-gray-400 uppercase tracking-wider mb-1.5">
              <span>HTTP Security Baseline</span>
              <div className="flex items-center gap-1.5">
                <span className={`px-1.5 py-0.5 rounded ${security.httpsEnforced ? 'bg-success-500/20 text-success-300' : 'bg-danger-500/20 text-danger-300'}`}>
                  {security.httpsEnforced ? 'SECURE' : 'INSECURE'}
                </span>
                {security.measurementConfidence && (
                  <span className={`px-1.5 py-0.5 rounded border ${
                    security.measurementConfidence === 'full'
                      ? 'bg-success-500/10 text-success-300 border-success-500/30'
                      : security.measurementConfidence === 'cors_limited'
                        ? 'bg-warning-500/10 text-warning-300 border-warning-500/30'
                        : 'bg-white/5 text-gray-400 border-white/10'
                  }`}>
                    {security.measurementConfidence}
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-1.5 text-xs text-gray-300">
              <div className="flex items-center justify-between">
                <span>HTTPS Enforced:</span>
                <span className={`font-mono ${security.httpsEnforced ? 'text-success-400' : 'text-danger-400'}`}>
                  {security.httpsEnforced ? 'Yes' : 'No'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Redirects to HTTPS:</span>
                <span className={`font-mono ${security.redirectsToHttps ? 'text-success-400' : 'text-gray-500'}`}>
                  {security.redirectsToHttps ? 'Yes' : 'No'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>HSTS Header:</span>
                <span className={`font-mono ${security.hstsEnabled ? 'text-success-400' : 'text-warning-400'}`}>
                  {security.hstsEnabled ? 'Active' : 'Missing'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Content Security (CSP):</span>
                <span className={`font-mono ${security.cspDetected ? 'text-success-400' : 'text-gray-500'}`}>
                  {security.cspDetected ? 'Detected' : 'Standard'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>security.txt:</span>
                <span className={`font-mono ${security.securityTxtPresent ? 'text-success-400' : 'text-gray-500'}`}>
                  {security.securityTxtPresent ? 'Present' : 'Missing'}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-2.5 pt-2 border-t border-white/5 text-[10px] text-gray-500 font-mono">
            Verified across Google & Cloudflare security standards
          </div>
        </div>

      </div>

      {/* SameAs Injected Entities Banner */}
      {sameAsUrls.length > 0 && (
        <div className="mt-3.5 pt-3 border-t border-white/10 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-gold-light uppercase tracking-wider font-bold">
              Injected sameAs URIs:
            </span>
            {sameAsUrls.map((uri, idx) => (
              <a
                key={idx}
                href={uri}
                target="_blank"
                rel="noopener noreferrer"
                className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] font-mono text-cyan-300 flex items-center gap-1"
              >
                <span>{uri.includes('wikidata') ? 'Wikidata QID' : 'Wikipedia Entity'}</span>
                <ICONS.ExternalLink className="w-2.5 h-2.5" />
              </a>
            ))}
          </div>

          <span className="text-[10px] text-gray-400 italic">
            Appended to Schema.org @graph to ensure zero-ambiguity LLM citations.
          </span>
        </div>
      )}
    </div>
  );
};
