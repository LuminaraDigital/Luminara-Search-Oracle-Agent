import React, { useEffect, useRef, useState } from 'react';
import { AGENCY_TIPS, AUDIT_STEPS, advanceAuditStep } from '../../services/audit/auditProgress';

/** shortcut: same path as the inline #boot-splash skyline, so the handoff does not jump */
export const SKYLINE_D = 'M6 76H22L32 56H46L56 76H72L84 44H108L120 76H136L144 62H168L176 76H194L206 40H230L242 76H268';

type PlaceLoaderProps = {
  label?: string;
  steps?: readonly string[];
  activeStep?: number;
  tips?: readonly string[];
  /** Stay off screen until this many milliseconds. Fast loads never paint it. */
  holdMs?: number;
  compact?: boolean;
  /** Centre the scene in a route-sized space. Audit waits stay under the form. */
  fill?: boolean;
};

function useHeld(holdMs: number): boolean {
  const [held, setHeld] = useState(holdMs <= 0);
  useEffect(() => {
    if (holdMs <= 0) return;
    const id = window.setTimeout(() => setHeld(true), holdMs);
    return () => window.clearTimeout(id);
  }, [holdMs]);
  return held;
}

function useTip(tips: readonly string[] | undefined, on: boolean): string {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!on || !tips || tips.length < 2) return;
    const id = window.setInterval(() => setIndex((n) => (n + 1) % tips.length), 5600);
    return () => window.clearInterval(id);
  }, [on, tips]);
  if (!tips || tips.length === 0) return '';
  return tips[index] ?? tips[0];
}

function shiftScene(event: React.PointerEvent<HTMLDivElement>) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const box = event.currentTarget.getBoundingClientRect();
  if (!box.width || !box.height) return;
  const x = ((event.clientX - box.left) / box.width - 0.5) * 12;
  const y = ((event.clientY - box.top) / box.height - 0.5) * 8;
  event.currentTarget.style.setProperty('--shift-x', `${x.toFixed(2)}px`);
  event.currentTarget.style.setProperty('--shift-y', `${y.toFixed(2)}px`);
}

export const PlaceLoader: React.FC<PlaceLoaderProps> = ({
  label = 'Loading…',
  steps,
  activeStep = 0,
  tips,
  holdMs = 300,
  compact = false,
  fill = false,
}) => {
  const held = useHeld(holdMs);
  const rootRef = useRef<HTMLDivElement>(null);
  const tip = useTip(tips, held);
  const stepCount = steps?.length ?? 0;
  const current = stepCount > 0 ? Math.min(Math.max(activeStep, 0), stepCount - 1) : 0;
  const caption = steps && steps.length > 0 ? steps[current] : label;
  const determinate = stepCount > 0;
  const pct = determinate ? Math.round(((current + 1) / stepCount) * 100) : 0;

  useEffect(() => {
    if (!held || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const onTilt = (event: DeviceOrientationEvent) => {
      const node = rootRef.current;
      if (!node || typeof event.gamma !== 'number') return;
      const x = Math.max(-20, Math.min(20, event.gamma)) / 20 * 12;
      const y = Math.max(-20, Math.min(20, (event.beta ?? 0) - 40)) / 20 * 8;
      node.style.setProperty('--shift-x', `${x.toFixed(2)}px`);
      node.style.setProperty('--shift-y', `${y.toFixed(2)}px`);
    };
    window.addEventListener('deviceorientation', onTilt);
    return () => window.removeEventListener('deviceorientation', onTilt);
  }, [held]);

  return (
    <div
      ref={rootRef}
      className={`lx-load${compact ? ' lx-load--compact' : ''}${fill ? ' lx-load--fill' : ''}`}
      hidden={!held}
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={caption}
      onPointerMove={shiftScene}
    >
      <p className="lx-word">Luminara</p>
      <svg className="lx-scene" viewBox="0 0 320 100" aria-hidden="true">
        <g className="lx-grid">
          <path d="M0 28H320M0 52H320M0 76H320M48 12V88M112 12V88M176 12V88M240 12V88" />
        </g>
        <path className="lx-line" pathLength="1" d={SKYLINE_D} />
        <g className="lx-pin">
          <title>Map pin</title>
          <circle className="lx-pulse" cx="268" cy="52" r="14" />
          <path d="M268 30c-8 0-14 7-14 15 0 10 14 28 14 28s14-18 14-28c0-8-6-15-14-15z" />
          <circle className="lx-pin-hole" cx="268" cy="44" r="3.5" />
        </g>
      </svg>
      {stepCount === 0 && <p className="lx-caption">{caption}</p>}
      {steps && steps.length > 0 && (
        <ol className="lx-steps">
          {steps.map((step, index) => (
            <li
              key={step}
              className={index === current ? 'is-now' : index < current ? 'is-done' : 'is-wait'}
              aria-current={index === current ? 'step' : undefined}
            >
              {step}
            </li>
          ))}
        </ol>
      )}
      {tip && <p className="lx-tip" aria-hidden="true">{tip}</p>}
      <div
        className="lx-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={determinate ? 100 : undefined}
        aria-valuenow={determinate ? pct : undefined}
        aria-valuetext={caption}
      >
        <div className={determinate ? 'lx-fill lx-fill--set' : 'lx-fill'} style={determinate ? { width: `${pct}%` } : undefined} />
      </div>
    </div>
  );
};

/** Audit wait. The step follows the crew message and never moves backward. */
export const AuditProgress: React.FC<{ stage: string }> = ({ stage }) => {
  const [index, setIndex] = useState(() => advanceAuditStep(0, stage));
  useEffect(() => {
    setIndex((previous) => advanceAuditStep(previous, stage));
  }, [stage]);
  return (
    <PlaceLoader
      label={AUDIT_STEPS[index]}
      steps={AUDIT_STEPS}
      activeStep={index}
      tips={AGENCY_TIPS}
    />
  );
};
