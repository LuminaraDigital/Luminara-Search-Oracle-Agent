import React, { useState } from 'react';
import {
  buildSchemaGraph,
  schemaScriptTag,
  type BusinessType,
  type SchemaOptions,
} from '../../../services/freeTools/schemaJsonLd';
import type { MarketingFaqItem } from '../../../services/marketing/marketingFaqContent';
import { ToolField, ToolOutput, ToolSegmented } from './toolFields';

const TYPES = [
  { id: 'RealEstateAgent', label: 'Real estate agent' },
  { id: 'LocalBusiness', label: 'Local business' },
] as const;

type TextKey = Exclude<keyof SchemaOptions, 'type' | 'areaServed' | 'sameAs' | 'faq'>;

const TEXT_FIELDS: ReadonlyArray<{ key: TextKey; label: string; url?: boolean }> = [
  { key: 'name', label: 'Business name' },
  { key: 'url', label: 'Website', url: true },
  { key: 'description', label: 'Short description' },
  { key: 'telephone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'street', label: 'Street address' },
  { key: 'locality', label: 'Suburb or city' },
  { key: 'region', label: 'State or region' },
  { key: 'postcode', label: 'Postcode' },
  { key: 'country', label: 'Country code' },
];

const EMPTY_FAQ: MarketingFaqItem[] = [
  { question: 'Do you charge for an appraisal?', answer: '' },
  { question: '', answer: '' },
  { question: '', answer: '' },
];

function lines(text: string): string[] {
  return text.split('\n');
}

export const SchemaTool: React.FC<{ onCopied: () => void }> = ({ onCopied }) => {
  const [type, setType] = useState<BusinessType>('RealEstateAgent');
  const [text, setText] = useState<Record<TextKey, string>>({
    name: 'Example Realty',
    url: 'https://www.example.com.au',
    description: '',
    telephone: '',
    email: '',
    street: '',
    locality: 'Hawthorn',
    region: 'VIC',
    postcode: '',
    country: 'AU',
  });
  const [areas, setAreas] = useState('Hawthorn\nKew\nCamberwell');
  const [profiles, setProfiles] = useState('');
  const [faq, setFaq] = useState<MarketingFaqItem[]>(EMPTY_FAQ);

  const setFaqItem = (index: number, patch: Partial<MarketingFaqItem>) =>
    setFaq((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));

  const graph = buildSchemaGraph({ type, ...text, areaServed: lines(areas), sameAs: lines(profiles), faq });

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="space-y-5">
        <ToolSegmented label="Business type" options={TYPES} value={type} onChange={setType} />
        <div className="grid gap-5 sm:grid-cols-2">
          {TEXT_FIELDS.map((field) => (
            <ToolField
              key={field.key}
              label={field.label}
              value={text[field.key]}
              inputMode={field.url ? 'url' : undefined}
              onChange={(value) => setText((prev) => ({ ...prev, [field.key]: value }))}
            />
          ))}
        </div>
        <ToolField label="Suburbs served, one per line" value={areas} onChange={setAreas} multiline rows={3} />
        <ToolField
          label="Profile links, one per line (optional)"
          value={profiles}
          onChange={setProfiles}
          multiline
          rows={2}
          hint="For example your Google Business Profile or LinkedIn page."
        />
        <fieldset className="space-y-4">
          <legend className="text-sm font-medium text-[var(--color-ink)]">Common questions (optional)</legend>
          {faq.map((item, index) => (
            <div key={index} className="grid gap-3 sm:grid-cols-2">
              <ToolField
                label={`Question ${index + 1}`}
                value={item.question}
                onChange={(question) => setFaqItem(index, { question })}
              />
              <ToolField
                label={`Answer ${index + 1}`}
                value={item.answer}
                onChange={(answer) => setFaqItem(index, { answer })}
              />
            </div>
          ))}
        </fieldset>
      </div>

      <div className="space-y-4">
        <ToolOutput label="JSON-LD" text={schemaScriptTag(graph)} onCopied={onCopied} />
        <p className="text-xs text-[var(--color-ink-2)]">
          Empty fields are left out, and a question without an answer is skipped. Paste the tag into the page it
          describes, then check it in Google&apos;s Rich Results Test.
        </p>
      </div>
    </div>
  );
};
