import React, { useState } from 'react';
import {
  checkDescription,
  checkTitle,
  serpHeadHtml,
  type LengthVerdict,
  type SerpDevice,
  type SerpFieldCheck,
} from '../../../services/freeTools/serpPreview';
import { SerpResultCard } from '../SerpResultCard';
import { ToolField, ToolOutput, ToolSegmented } from './toolFields';

const DEVICES = [
  { id: 'desktop', label: 'Desktop' },
  { id: 'mobile', label: 'Mobile' },
] as const;

const VERDICT_TEXT: Record<LengthVerdict, string> = {
  empty: 'Empty. Google will write its own.',
  short: 'Short. There is room for more detail.',
  good: 'Fits.',
  truncated: 'Google will likely cut this.',
};

const Counter: React.FC<{ check: SerpFieldCheck; scope: string }> = ({ check, scope }) => (
  <span className={check.verdict === 'truncated' ? 'text-[var(--gold-light)]' : undefined}>
    {check.chars} characters · about {check.px} of {check.maxPx} px {scope}. {VERDICT_TEXT[check.verdict]}
  </span>
);

export const SerpPreviewTool: React.FC<{ onCopied: () => void }> = ({ onCopied }) => {
  const [url, setUrl] = useState('https://www.example.com.au/suburbs/hawthorn');
  const [siteName, setSiteName] = useState('Example Realty');
  const [title, setTitle] = useState('Hawthorn real estate agent | Sell your home with Example Realty');
  const [description, setDescription] = useState(
    'Thinking of selling in Hawthorn? See recent sales, what your home could be worth, and book a free appraisal with a local agent.',
  );
  const [device, setDevice] = useState<SerpDevice>('desktop');

  const titleCheck = checkTitle(title);
  const descriptionCheck = checkDescription(description, device);

  return (
    // The preview column gets 3/5 of the row so a 600px desktop title fits on one line, as on Google.
    <div className="grid gap-8 lg:grid-cols-[2fr_3fr]">
      <div className="space-y-5">
        <ToolField label="Page URL" value={url} onChange={setUrl} inputMode="url" />
        <ToolField label="Site name" value={siteName} onChange={setSiteName} />
        <ToolField
          label="Title tag"
          value={title}
          onChange={setTitle}
          hint={<Counter check={titleCheck} scope="on desktop" />}
        />
        <ToolField
          label="Meta description"
          value={description}
          onChange={setDescription}
          multiline
          hint={<Counter check={descriptionCheck} scope={`on ${device}`} />}
        />
      </div>

      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="lx-eyebrow">Estimated preview</p>
          <ToolSegmented label="Device" options={DEVICES} value={device} onChange={setDevice} />
        </div>
        <SerpResultCard
          url={url}
          siteName={siteName}
          title={title}
          description={description}
          device={device}
          label="Estimated Google result"
        />
        <p className="text-xs text-[var(--color-ink-2)]">
          An estimate from your tags. Google can rewrite a title or choose a different snippet.
        </p>
        <ToolOutput label="Head tags" text={serpHeadHtml(title, description)} onCopied={onCopied} />
      </div>
    </div>
  );
};
