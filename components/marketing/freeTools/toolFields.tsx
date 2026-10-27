import React, { useEffect, useId, useRef, useState } from 'react';

const LABEL = 'block text-sm font-medium text-[var(--color-ink)]';
const HINT = 'mt-1 text-xs text-[var(--color-ink-2)]';

interface FieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: React.ReactNode;
  multiline?: boolean;
  rows?: number;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
}

/** Labeled text input or textarea in the space style. */
export const ToolField: React.FC<FieldProps> = ({
  label,
  value,
  onChange,
  placeholder,
  hint,
  multiline = false,
  rows = 3,
  inputMode,
}) => {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div>
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      {multiline ? (
        <textarea
          id={id}
          rows={rows}
          value={value}
          placeholder={placeholder}
          aria-describedby={hintId}
          onChange={(e) => onChange(e.target.value)}
          className="lx-field mt-2"
        />
      ) : (
        <input
          id={id}
          type="text"
          value={value}
          placeholder={placeholder}
          inputMode={inputMode}
          spellCheck={inputMode === 'url' ? false : undefined}
          aria-describedby={hintId}
          onChange={(e) => onChange(e.target.value)}
          className="lx-field mt-2"
        />
      )}
      {hint && (
        <p id={hintId} className={HINT}>
          {hint}
        </p>
      )}
    </div>
  );
};

/** Pill toggle group. `value` null means no option matches the current settings. */
export function ToolSegmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ReadonlyArray<{ id: T; label: string }>;
  value: T | null;
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={option.id === value}
          onClick={() => onChange(option.id)}
          className="lx-chip"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Read-only output with a copy button. `onCopied` fires once per successful copy. */
export const ToolOutput: React.FC<{ label: string; text: string; onCopied?: () => void }> = ({
  label,
  text,
  onCopied,
}) => {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = () => {
    if (!navigator.clipboard) return;
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        onCopied?.();
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => undefined);
  };

  return (
    <div className="lx-glass rounded-2xl p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="lx-eyebrow">{label}</p>
        <button type="button" onClick={copy} className="lx-btn lx-btn-ghost min-h-0 px-4 py-1.5 text-xs">
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="lx-code mt-4" tabIndex={0} aria-label={label}>
        {text}
      </pre>
      <p aria-live="polite" className="sr-only">
        {copied ? `${label} copied` : ''}
      </p>
    </div>
  );
};
