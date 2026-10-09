import React, { useState } from 'react';
import { ICONS } from '../ui/icons';
import { Button } from '../ui/Button';
import type { BrandPassport } from '../../services/trust/brandPassport';

export interface UniversalBrandPassportViewProps {
  passport: BrandPassport;
}

export const UniversalBrandPassportView: React.FC<UniversalBrandPassportViewProps> = ({ passport }) => {
  const [activeTab, setActiveTab] = useState<'schema' | 'badge'>('schema');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleCopy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2500);
    } catch {
      // fallback
    }
  };

  return (
    <div className="rounded-xl border border-gold/30 bg-slate-900/60 p-5 backdrop-blur-sm">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <ICONS.Shield className="h-5 w-5 text-gold" />
            <h3 className="text-lg font-semibold text-ink">Universal Brand Passport</h3>
          </div>
          <p className="mt-1 text-xs text-ink-muted">
            Portable brand authority for {passport.domain}. Combines verified domain control, Business DNA, and Trust Receipts.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {passport.isVerified ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/40 bg-gold/10 px-3 py-1 text-xs font-medium text-gold">
              <span className="h-1.5 w-1.5 rounded-full bg-gold animate-pulse" />
              Verified by Luminara
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/5 px-3 py-1 text-xs font-medium text-ink-muted">
              Pending verification
            </span>
          )}
          <span className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-ink-muted">
            {passport.receiptsCount} {passport.receiptsCount === 1 ? 'Receipt' : 'Receipts'}
          </span>
        </div>
      </div>

      {/* Brand Context */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs">
        <div className="rounded-lg border border-white/5 bg-black/40 p-3">
          <span className="text-ink-muted">Brand Name:</span>
          <p className="mt-0.5 font-medium text-ink">{passport.brandName}</p>
        </div>
        {passport.industry && (
          <div className="rounded-lg border border-white/5 bg-black/40 p-3">
            <span className="text-ink-muted">Industry:</span>
            <p className="mt-0.5 font-medium text-ink">{passport.industry}</p>
          </div>
        )}
      </div>

      {/* Export Tabs */}
      <div className="mt-5">
        <div className="flex items-center gap-2 border-b border-white/10 pb-2">
          <button
            type="button"
            onClick={() => setActiveTab('schema')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              activeTab === 'schema'
                ? 'bg-gold/20 text-gold border border-gold/30'
                : 'text-ink-muted hover:text-ink'
            }`}
          >
            Organization JSON-LD
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('badge')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              activeTab === 'badge'
                ? 'bg-gold/20 text-gold border border-gold/30'
                : 'text-ink-muted hover:text-ink'
            }`}
          >
            Embed Trust Badge
          </button>
        </div>

        <div className="mt-3">
          {activeTab === 'schema' ? (
            <div>
              <div className="flex items-center justify-between pb-2">
                <span className="text-xs text-ink-muted">
                  Canonical Schema.org JSON-LD markup to paste into your website &lt;head&gt;.
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleCopy('schema', passport.schemaJsonLd)}
                  className="text-xs"
                >
                  {copiedKey === 'schema' ? 'Copied' : 'Copy JSON-LD'}
                </Button>
              </div>
              <pre className="max-h-48 overflow-x-auto rounded-lg border border-white/10 bg-black/60 p-3 text-[11px] font-mono text-emerald-400">
                {passport.schemaJsonLd}
              </pre>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between pb-2">
                <span className="text-xs text-ink-muted">
                  Live embeddable HTML badge linking to your verifiable Luminara Trust profile.
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleCopy('badge', passport.embedBadgeSnippet)}
                  className="text-xs"
                >
                  {copiedKey === 'badge' ? 'Copied' : 'Copy HTML'}
                </Button>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/60 p-4">
                <span className="text-[11px] text-ink-muted block mb-2">Live Preview:</span>
                <div
                  dangerouslySetInnerHTML={{ __html: passport.embedBadgeSnippet }}
                  className="inline-block"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
