/**
 * SEO methodology playbooks compiled from the vendored claude-seo skills (MIT, AgriciDaniel).
 * The app injects the relevant playbooks into audit and chat prompts so recommendations follow
 * a published, primary-source methodology instead of whatever the model improvises.
 *
 * Regenerate with `npm run playbooks` after editing `.claude/skills/*`.
 */
import generated from './playbooks.generated.json';
import type { BusinessDNA, ReportFocus } from '../../types';

export interface Playbook {
  id: string;
  title: string;
  tags: string[];
  chars: number;
  body: string;
}

export type AuditLens = 'local' | 'ecommerce' | 'schema' | 'content' | 'sxo';

export const AUDIT_LENSES: Array<{ id: AuditLens; label: string; hint: string }> = [
  { id: 'local', label: 'Local business', hint: 'Google Business Profile, reviews, map pack, citations' },
  { id: 'ecommerce', label: 'Online store', hint: 'Product pages, product schema, merchant requirements' },
  { id: 'content', label: 'Content quality', hint: 'E-E-A-T, authorship, freshness, AI-content markers' },
  { id: 'schema', label: 'Structured data', hint: 'Schema.org types that still earn rich results' },
  { id: 'sxo', label: 'Search experience', hint: 'Does the page do what the searcher came for?' },
];

export const PLAYBOOKS: Playbook[] = (generated as { playbooks: Playbook[] }).playbooks;

const byId = new Map(PLAYBOOKS.map(p => [p.id, p]));

export function getPlaybook(id: string): Playbook | undefined {
  return byId.get(id);
}

/** Lenses implied by the business profile, so a dentist gets the local playbook without asking. */
export function inferLenses(dna?: BusinessDNA | null): AuditLens[] {
  if (!dna) return [];
  const text = `${dna.name} ${dna.mission} ${dna.usp} ${dna.targetAudience} ${dna.rawContext}`.toLowerCase();
  const lenses: AuditLens[] = [];
  if (/\b(clinic|dentist|dental|restaurant|salon|plumber|electrician|lawyer|attorney|realtor|broker|near me|local|city|neighborhood|store front|storefront|in [A-Z][a-z]+)\b/i.test(text)) lenses.push('local');
  if (/\b(shop|store|e-commerce|ecommerce|products?|cart|checkout|shopify|woocommerce|catalog|sku)\b/i.test(text)) lenses.push('ecommerce');
  return lenses;
}

/** Playbooks for an audit: core rules + the focus playbooks + any lenses. */
export function selectAuditPlaybooks(focus: ReportFocus, lenses: AuditLens[] = []): Playbook[] {
  const ids: string[] = ['core'];
  if (focus === 'SEO') ids.push('technical', 'content', 'schema');
  if (focus === 'AEO') ids.push('geo', 'schema');
  if (focus === 'GEO') ids.push('geo', 'content');
  for (const lens of lenses) ids.push(lens);
  return [...new Set(ids)].map(id => byId.get(id)).filter((p): p is Playbook => Boolean(p));
}

const CHAT_TRIGGERS: Array<{ id: string; test: RegExp }> = [
  { id: 'geo', test: /ai overview|ai answer|ai search|chatgpt|perplexity|gemini|\baeo\b|\bgeo\b|cited|citation|llms\.txt/i },
  { id: 'schema', test: /schema|json-ld|structured data|rich result|faq schema|markup/i },
  { id: 'local', test: /google business|gbp|map pack|near me|local seo|citations?\b|reviews?\b/i },
  { id: 'ecommerce', test: /product page|e-?commerce|shopify|merchant|shopping|\bsku\b|add to cart/i },
  { id: 'technical', test: /core web vitals|\binp\b|\blcp\b|\bcls\b|crawl|index(ing|ed|ability)|robots|sitemap|canonical|redirect|javascript rendering|page speed/i },
  { id: 'content', test: /e-e-a-t|eeat|thin content|content quality|author|freshness|ai content|helpful content/i },
];

/** Playbooks worth attaching to a chat turn, most specific first, at most two. */
export function selectChatPlaybooks(prompt: string): Playbook[] {
  const hits = CHAT_TRIGGERS.filter(t => t.test.test(prompt)).map(t => byId.get(t.id)).filter((p): p is Playbook => Boolean(p));
  return hits.slice(0, 2);
}

/** Renders playbooks as a prompt block within a character budget (oldest-first truncation). */
export function playbookContext(playbooks: Playbook[], budgetChars = 24000): string {
  if (!playbooks.length) return '';
  let remaining = budgetChars;
  const blocks: string[] = [];
  for (const p of playbooks) {
    if (remaining <= 400) break;
    const body = p.body.length > remaining ? p.body.slice(0, remaining).replace(/\n[^\n]*$/, '') + '\n…' : p.body;
    remaining -= body.length;
    blocks.push(`### Playbook: ${p.title}\n${body}`);
  }
  return [
    '[SEO METHODOLOGY PLAYBOOKS]',
    'Apply the criteria, thresholds and deprecation rules below. They come from a published, primary-source methodology (claude-seo, MIT). Where a check needs data you do not have (field Core Web Vitals, crawl logs, backlink indexes), write "not measured" instead of estimating a number.',
    ...blocks,
    '--------------------------------------------------',
  ].join('\n\n');
}
