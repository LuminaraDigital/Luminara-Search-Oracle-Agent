import React from 'react';
import type { BusinessDNA } from '../../types';

const MAX_FACTS = 8;

function lines(value: string): string[] {
  return value.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, MAX_FACTS);
}

/** The owner's own facts, which Visibility Unit Tests check AI answers against. */
export const BusinessFactsPanel: React.FC<{
  dna: BusinessDNA;
  editing: boolean;
  onChange: (next: BusinessDNA) => void;
  onConfirm: (next: BusinessDNA) => void;
}> = ({ dna, editing, onChange, onConfirm }) => {
  const facts = dna.keyFacts ?? [];
  const banned = dna.negativeConstraints ?? [];
  const edit = (patch: Partial<BusinessDNA>) => onChange({ ...dna, ...patch });

  return (
    <div className="pt-4 border-t border-white/10 space-y-3">
      <div>
        <label htmlFor="dna-key-facts" className="block text-[10px] font-bold uppercase tracking-widest text-gold-light mb-1">
          Facts AI should get right
        </label>
        {editing ? (
          <textarea
            id="dna-key-facts"
            key={`facts-${dna.name}`}
            rows={3}
            defaultValue={facts.join('\n')}
            onChange={(e) => edit({ keyFacts: lines(e.target.value) })}
            placeholder={'One fact on each line, for example:\nOpen since 2011\n02 9000 0000'}
            className="w-full bg-black/60 border border-white/20 rounded-xl p-3 text-xs text-white"
          />
        ) : (
          <p className="text-xs text-gray-300 bg-black/40 p-3 rounded-xl border border-white/5 whitespace-pre-line">
            {facts.join('\n') || 'None yet. Choose Edit to add some.'}
          </p>
        )}
      </div>
      <div>
        <label htmlFor="dna-banned-claims" className="block text-[10px] font-bold uppercase tracking-widest text-gold-light mb-1">
          Things AI should never say about you
        </label>
        {editing ? (
          <textarea
            id="dna-banned-claims"
            key={`banned-${dna.name}`}
            rows={2}
            defaultValue={banned.join('\n')}
            onChange={(e) => edit({ negativeConstraints: lines(e.target.value) })}
            placeholder="One on each line"
            className="w-full bg-black/60 border border-white/20 rounded-xl p-3 text-xs text-white"
          />
        ) : (
          <p className="text-xs text-gray-300 bg-black/40 p-3 rounded-xl border border-white/5 whitespace-pre-line">
            {banned.join('\n') || 'None yet.'}
          </p>
        )}
      </div>
      {!editing && (
        dna.factsConfirmedAt ? (
          <p className="text-xs text-success-400" role="status">You confirmed these facts. Visibility checks now use them.</p>
        ) : (
          <button
            type="button"
            onClick={() => onConfirm({ ...dna, factsConfirmedAt: Date.now() })}
            className="px-4 py-2 rounded-xl border border-gold/40 text-gold-light text-xs font-bold focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
          >
            These facts are correct
          </button>
        )
      )}
    </div>
  );
};
