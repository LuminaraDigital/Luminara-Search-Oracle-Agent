import React, { useState } from 'react';
import { buildLlmsTxt, type LlmsLink } from '../../../services/freeTools/llmsTxt';
import { ToolField, ToolOutput } from './toolFields';

const MAX_LINKS = 12;

const STARTER_LINKS: LlmsLink[] = [
  { title: 'Sell with us', url: 'https://www.example.com.au/sell', note: 'How we sell, our fees, and how to book an appraisal' },
  { title: 'Hawthorn suburb guide', url: 'https://www.example.com.au/suburbs/hawthorn', note: 'Recent sales, schools and transport' },
  { title: 'Contact', url: 'https://www.example.com.au/contact', note: 'Office address, phone and opening hours' },
];

export const LlmsTxtTool: React.FC<{ onCopied: () => void }> = ({ onCopied }) => {
  const [siteName, setSiteName] = useState('Example Realty');
  const [summary, setSummary] = useState('Independent real estate agency selling and leasing homes in Hawthorn, Kew and Camberwell.');
  const [details, setDetails] = useState('Family owned since 2004. We publish a suburb guide for every suburb we sell in.');
  const [heading, setHeading] = useState('Key pages');
  const [links, setLinks] = useState<LlmsLink[]>(STARTER_LINKS);

  const setLink = (index: number, patch: Partial<LlmsLink>) =>
    setLinks((prev) => prev.map((link, i) => (i === index ? { ...link, ...patch } : link)));

  const output = buildLlmsTxt({ siteName, summary, details, sections: [{ heading, links }] });

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="space-y-5">
        <ToolField label="Business name" value={siteName} onChange={setSiteName} />
        <ToolField label="One-sentence summary" value={summary} onChange={setSummary} multiline rows={2} />
        <ToolField label="More detail (optional)" value={details} onChange={setDetails} multiline rows={3} />
        <ToolField label="Section heading" value={heading} onChange={setHeading} />

        <fieldset className="space-y-4">
          <legend className="text-sm font-medium text-[var(--color-ink)]">Pages</legend>
          {links.map((link, index) => (
            <div key={index} className="lx-glass space-y-3 rounded-2xl p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-[var(--color-ink-2)]">Page {index + 1}</p>
                <button
                  type="button"
                  onClick={() => setLinks((prev) => prev.filter((_, i) => i !== index))}
                  className="lx-link text-xs"
                  aria-label={`Remove page ${index + 1}`}
                >
                  Remove
                </button>
              </div>
              <ToolField label="Title" value={link.title} onChange={(title) => setLink(index, { title })} />
              <ToolField label="URL" value={link.url} onChange={(url) => setLink(index, { url })} inputMode="url" />
              <ToolField label="Short note" value={link.note} onChange={(note) => setLink(index, { note })} />
            </div>
          ))}
          {links.length < MAX_LINKS && (
            <button
              type="button"
              onClick={() => setLinks((prev) => [...prev, { title: '', url: '', note: '' }])}
              className="lx-btn lx-btn-ghost"
            >
              Add a page
            </button>
          )}
        </fieldset>
      </div>

      <div className="space-y-4">
        <ToolOutput label="llms.txt" text={output} onCopied={onCopied} />
        <p className="text-xs text-[var(--color-ink-2)]">
          Pages without a title or a valid web address are left out. Save the file as llms.txt at the root of your site.
        </p>
      </div>
    </div>
  );
};
