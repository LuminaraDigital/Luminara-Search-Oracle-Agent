/**
 * Ready-to-paste drafts for an independent agency. Only fields the caller supplies are written.
 * Blank slots stay in brackets. Nothing here is published, and no ranking or review count is added.
 */

export const FIX_DRAFT_KINDS = ['suburb_page', 'agent_bio', 'about_page', 'faq_block', 'json_ld'] as const;
export type FixDraftKind = (typeof FIX_DRAFT_KINDS)[number];

export type FixDraftInput = {
  kind: FixDraftKind;
  businessName?: string;
  agentName?: string;
  suburb?: string;
  phone?: string;
  address?: string;
  serviceArea?: string;
  findingTitle?: string;
  domain?: string;
};

export type FixDraft = {
  kind: FixDraftKind;
  markdown: string;
  jsonLd: string | null;
  filled: string[];
  blank: string[];
  note: string;
};

const NOTE = 'Draft only. Paste it and edit it. Nothing was published to your site.';
const FIELD_MAX = 200;

function clean(value: string | undefined): string {
  return (value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, FIELD_MAX);
}

function slot(value: string | undefined, label: string, filled: string[], blank: string[]): string {
  const text = clean(value);
  if (!text) {
    blank.push(label);
    return `[${label}]`;
  }
  filled.push(label);
  return text;
}

function httpsHost(value: string | undefined): string | null {
  const host = clean(value).toLowerCase().replace(/^https?:\/\//, '').split('/')[0]?.replace(/\.$/, '') || '';
  if (!host || host.length > 253 || !host.includes('.') || !/^[a-z0-9.-]+$/.test(host)) return null;
  if (host.startsWith('.') || host.endsWith('.') || host.includes('..')) return null;
  return host;
}

function findingLine(title: string | undefined): string[] {
  const text = clean(title);
  if (!text) return [];
  return ['', `This draft follows the finding you sent: ${text}`, 'That title was not re-checked.'];
}

function agentJsonLd(fields: {
  businessName: string;
  phone: string;
  address: string;
  serviceArea: string;
  suburb: string;
  host: string | null;
}): string {
  const body: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'RealEstateAgent',
  };
  if (!fields.businessName.startsWith('[')) body.name = fields.businessName;
  if (fields.host) body.url = `https://${fields.host}`;
  if (!fields.phone.startsWith('[')) body.telephone = fields.phone;
  if (!fields.address.startsWith('[')) body.address = fields.address;
  const area = !fields.serviceArea.startsWith('[') ? fields.serviceArea : !fields.suburb.startsWith('[') ? fields.suburb : '';
  if (area) body.areaServed = area;
  return JSON.stringify(body, null, 2);
}

export function isFixDraftKind(value: unknown): value is FixDraftKind {
  return typeof value === 'string' && (FIX_DRAFT_KINDS as readonly string[]).includes(value);
}

export function buildFixDraft(input: FixDraftInput): FixDraft {
  const filled: string[] = [];
  const blank: string[] = [];
  const businessName = slot(input.businessName, 'Agency name', filled, blank);
  const agentName = slot(input.agentName, 'Agent name', filled, blank);
  const suburb = slot(input.suburb, 'Suburb', filled, blank);
  const phone = slot(input.phone, 'Phone', filled, blank);
  const address = slot(input.address, 'Address', filled, blank);
  const serviceArea = slot(input.serviceArea, 'Service area', filled, blank);
  const host = httpsHost(input.domain);
  if (host) filled.push('Website');
  const siteLine = host ? [`Website: https://${host}`, ''] : [];
  const finding = findingLine(input.findingTitle);
  const caution = 'Replace each bracketed line before you paste this. Do not add awards, review counts, or years in business unless you can point at them.';
  let markdown = '';
  let jsonLd: string | null = null;

  if (input.kind === 'suburb_page') {
    markdown = [
      `# Real estate in ${suburb}`,
      '',
      `${businessName} is an independent real estate agency working in ${suburb}.`,
      '',
      `Call ${phone}.`,
      `Office: ${address}.`,
      ...siteLine,
      ...finding,
      '',
      caution,
    ].join('\n');
  } else if (input.kind === 'agent_bio') {
    markdown = [
      `# ${agentName}`,
      '',
      `${agentName} works with ${businessName} in ${suburb}.`,
      '',
      `Phone: ${phone}.`,
      ...siteLine,
      ...finding,
      '',
      caution,
    ].join('\n');
  } else if (input.kind === 'about_page') {
    const where = serviceArea.startsWith('[') ? suburb : serviceArea;
    markdown = [
      `# About ${businessName}`,
      '',
      `${businessName} is an independent real estate agency serving ${where}.`,
      '',
      `Phone: ${phone}.`,
      `Address: ${address}.`,
      ...siteLine,
      ...finding,
      '',
      caution,
    ].join('\n');
  } else if (input.kind === 'faq_block') {
    const where = serviceArea.startsWith('[') ? suburb : serviceArea;
    const whereAnswer = `${businessName} serves ${where}.`;
    const contactAnswer = `Call ${phone}.`;
    markdown = [
      `# Questions people ask ${businessName}`,
      '',
      `## Where does ${businessName} work?`,
      whereAnswer,
      '',
      `## How do I contact ${businessName}?`,
      contactAnswer,
      ...finding,
      '',
      'The FAQ schema includes a question only when its answer has no empty slot.',
    ].join('\n');
    const questions = [
      { q: `Where does ${businessName} work?`, a: whereAnswer },
      { q: `How do I contact ${businessName}?`, a: contactAnswer },
    ].filter((item) => !item.a.includes('['));
    if (questions.length) {
      jsonLd = JSON.stringify(
        {
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: questions.map((item) => ({
            '@type': 'Question',
            name: item.q,
            acceptedAnswer: { '@type': 'Answer', text: item.a },
          })),
        },
        null,
        2,
      );
    }
  } else {
    const kind: 'json_ld' = input.kind;
    void kind;
    jsonLd = agentJsonLd({ businessName, phone, address, serviceArea, suburb, host });
    markdown = [
      '# RealEstateAgent JSON-LD',
      '',
      'Paste this into the homepage. Fields you left blank are omitted, not invented.',
      ...finding,
      '',
      '```json',
      jsonLd,
      '```',
    ].join('\n');
  }

  return {
    kind: input.kind,
    markdown: `${markdown}\n\n${NOTE}\n`,
    jsonLd: input.kind === 'faq_block' ? jsonLd : input.kind === 'json_ld' ? jsonLd : null,
    filled,
    blank,
    note: NOTE,
  };
}
