import React, { useState } from 'react';
import {
  checkDescription,
  checkTitle,
  serpBreadcrumb,
  serpHeadHtml,
  type LengthVerdict,
  type SerpDevice,
  type SerpFieldCheck,
} from '../../../services/freeTools/serpPreview';
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
  const crumb = serpBreadcrumb(url);

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
        {/* A light card, because Google results are light. Colours follow Google's light theme. */}
        <figure
          aria-label="Estimated Google result"
          className={`overflow-x-auto rounded-2xl bg-white p-4 font-[Arial,Helvetica,sans-serif] ${device === 'mobile' ? 'max-w-[360px]' : ''}`}
        >
          <div className="flex items-center gap-3">
            <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[rgb(241,243,244)] text-xs text-[rgb(77,81,86)]">
              {(siteName.trim() || crumb.site).slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm text-[rgb(32,33,36)]">{siteName.trim() || crumb.site}</p>
              <p className="truncate text-xs text-[rgb(77,81,86)]">
                https://{crumb.site}
                {crumb.crumbs.map((part) => ` › ${part}`).join('')}
              </p>
            </div>
          </div>
          <p
            className={`mt-2 text-xl leading-snug text-[rgb(26,13,171)] ${
              device === 'desktop' ? 'whitespace-nowrap' : '[overflow-wrap:anywhere]'
            }`}
          >
            {titleCheck.shown || crumb.site}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-[rgb(77,81,86)] [overflow-wrap:anywhere]">
            {descriptionCheck.shown || 'Google picks text from the page when there is no description.'}
          </p>
        </figure>
        <p className="text-xs text-[var(--color-ink-2)]">
          An estimate from your tags. Google can rewrite a title or choose a different snippet.
        </p>
        <ToolOutput label="Head tags" text={serpHeadHtml(title, description)} onCopied={onCopied} />
      </div>
    </div>
  );
};
