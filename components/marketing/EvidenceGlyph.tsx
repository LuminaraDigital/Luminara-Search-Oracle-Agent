import React from 'react';
import type { DemoEngineStatus } from './demo/demoFixtures';
import type { EvidenceState } from './earth/globeStory';

/** One label per engine status, so a new status cannot fall through to the wrong words. */
export const ENGINE_STATUS_LABEL: Record<DemoEngineStatus, string> = {
  idle: 'Not run yet',
  pending: 'Checking',
  measured: 'Measured',
  estimated: 'Estimated',
  not_measured: 'Not measured',
};

const STATUS_EVIDENCE: Partial<Record<DemoEngineStatus, EvidenceState>> = {
  measured: 'Measured',
  estimated: 'Estimated',
  not_measured: 'Not measured',
};

/** Filled = Measured, half = Estimated, dashed ring = Not measured (methodology semantics). */
export function EvidenceGlyph({ state }: { state: EvidenceState }) {
  const shape =
    state === 'Measured'
      ? 'bg-gold'
      : state === 'Estimated'
        ? 'border border-gold bg-[linear-gradient(90deg,var(--gold)_50%,transparent_50%)]'
        : 'border border-dashed border-[var(--color-ink-2)]';
  return <span aria-hidden className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${shape}`} />;
}

export function EngineStatusChip({ status }: { status: DemoEngineStatus }) {
  const evidence = STATUS_EVIDENCE[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[12px] ${
        status === 'measured' ? 'text-gold-light' : 'text-[var(--color-ink-2)]'
      }`}
    >
      {status === 'pending' && (
        <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-gold-light motion-safe:animate-pulse" />
      )}
      {evidence && <EvidenceGlyph state={evidence} />}
      {ENGINE_STATUS_LABEL[status]}
    </span>
  );
}
