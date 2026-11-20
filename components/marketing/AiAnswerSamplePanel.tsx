import React from 'react';
import type { AiAnswerSample } from '../../services/audit/aiAnswerSample';
import { EvidenceGlyph } from './EvidenceGlyph';

/**
 * The free check's one live sample. The label is the measurement.
 * Engine chips for named AI products stay Not measured beside this.
 */
export const AiAnswerSamplePanel: React.FC<{
  sample: AiAnswerSample;
  tone?: 'ink' | 'night';
}> = ({ sample, tone = 'ink' }) => {
  const night = tone === 'night';
  const ink = night ? 'text-white' : 'text-[var(--color-ink)]';
  const muted = night ? 'text-gray-300' : 'text-[var(--color-ink-2)]';
  const shell = night
    ? 'glass-morphism rounded-xl border border-gold/30 p-4 space-y-3'
    : 'space-y-3 border-b border-[var(--color-rule)] pb-4';
  const measured = sample.status === 'measured';

  return (
    <section className={shell} aria-label="AI answer sample">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={night ? 'text-sm font-bold text-gold-light' : 'lx-eyebrow'}>Does AI name this agency?</p>
        <p className={`inline-flex items-center gap-1.5 text-[12px] ${measured ? 'text-gold-light' : muted}`}>
          <EvidenceGlyph state={measured ? 'Measured' : 'Not measured'} />
          {sample.label}
        </p>
      </div>
      {measured ? (
        <>
          <p className={`text-sm ${ink}`}>
            {sample.named
              ? 'The agency name or domain appears in this sample.'
              : 'The agency name and domain do not appear in this sample.'}
          </p>
          <ul className="m-0 list-none space-y-3 p-0">
            {sample.prompts.map((row) => (
              <li key={row.prompt} className="space-y-1">
                <p className={`text-xs ${muted}`}>Asked: {row.prompt}</p>
                <p className={`text-sm whitespace-pre-wrap ${ink}`}>{row.answer}</p>
                <p className={`text-xs ${muted}`}>
                  {row.named ? 'Named in this answer.' : 'Not named in this answer.'}
                  {' '}
                  Other domains cited: {row.citedDomains.length > 0 ? row.citedDomains.join(', ') : 'none'}
                </p>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className={`text-sm ${muted}`}>{sample.reason}</p>
      )}
      <p className={`text-xs ${muted}`}>{sample.nextStep}</p>
    </section>
  );
};
