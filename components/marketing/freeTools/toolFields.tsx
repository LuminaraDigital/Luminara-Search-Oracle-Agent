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

/**
 * Pill radio group on native radios, so arrow keys and checked state come from the browser.
 * `value` null means no option matches the current settings.
 */
export function ToolSegmented<T extends string>({
  label,
  showLabel = false,
  options,
  value,
  onChange,
}: {
  label: string;
  showLabel?: boolean;
  options: ReadonlyArray<{ id: T; label: string }>;
  value: T | null;
  onChange: (value: T) => void;
}) {
  const name = useId();
  return (
    <fieldset>
      <legend className={showLabel ? `${LABEL} mb-3` : 'sr-only'}>{label}</legend>
      <div className="inline-flex flex-wrap gap-2">
        {options.map((option) => (
          <label key={option.id} className="lx-chip cursor-pointer">
            <input
              type="radio"
              name={name}
              value={option.id}
              checked={option.id === value}
              onChange={() => onChange(option.id)}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

type CopyState = 'idle' | 'copied' | 'failed';

const COPY_LABEL: Record<CopyState, string> = { idle: 'Copy', copied: 'Copied', failed: 'Text selected' };

/** Read-only output with a copy button. `onCopied` fires once per successful copy. */
export const ToolOutput: React.FC<{ label: string; text: string; onCopied: () => void }> = ({
  label,
  text,
  onCopied,
}) => {
  const [state, setState] = useState<CopyState>('idle');
  const preRef = useRef<HTMLPreElement>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const show = (next: CopyState) => {
    setState(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), 2500);
  };

  // Without clipboard access (some in-app browsers), select the text so the user can copy it.
  const selectText = () => {
    const pre = preRef.current;
    const selection = window.getSelection();
    if (!pre || !selection) return;
    selection.selectAllChildren(pre);
    show('failed');
  };

  const copy = () => {
    if (!navigator.clipboard) {
      selectText();
      return;
    }
    navigator.clipboard
      .writeText(text)
      .then(() => {
        show('copied');
        onCopied();
      })
      .catch(selectText);
  };

  return (
    <div className="lx-glass rounded-2xl p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="lx-eyebrow">{label}</p>
        <button type="button" onClick={copy} className="lx-btn lx-btn-ghost min-h-0 px-4 py-1.5 text-xs">
          {COPY_LABEL[state]}
        </button>
      </div>
      <pre ref={preRef} className="lx-code mt-4" tabIndex={0} role="region" aria-label={label}>
        {text}
      </pre>
      <p aria-live="polite" className="sr-only">
        {state === 'copied' ? `${label} copied` : state === 'failed' ? `${label} selected. Copy it now.` : ''}
      </p>
    </div>
  );
};
