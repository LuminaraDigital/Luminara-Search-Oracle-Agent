import { brandNameFor } from './brandName';
import type { OffSiteMentionChannel } from '../visibility/engineVisibilityTypes';

function cleanHost(host: string): string {
  return host.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] || 'example.com';
}

export type FixPackEvidence = {
  siteName?: string | null;
  description?: string | null;
  contactUrl?: string | null;
  facts?: string[];
};

function asEvidence(value?: string | FixPackEvidence | null): FixPackEvidence {
  if (!value) return {};
  if (typeof value === 'string') return { siteName: value };
  return value;
}

function oneLine(value: string | null | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

/** llms.txt draft. Filled lines are copied from the page. Missing lines are left out. */
export function llmsTxtDraft(host: string, siteNameOrEvidence?: string | FixPackEvidence | null): string {
  const evidence = asEvidence(siteNameOrEvidence);
  const brand = brandNameFor(host, evidence.siteName);
  const clean = cleanHost(host);
  const description = oneLine(evidence.description);
  const facts = (evidence.facts || []).map(oneLine).filter(Boolean);
  const lines = [
    brand ? `# ${brand}` : '# <Your agency name>',
    ...(description ? [`> ${description}`] : []),
    '',
    '## Pages',
    `- Official website: https://${clean}`,
  ];
  const contact = oneLine(evidence.contactUrl);
  if (contact) lines.push(`- Contact: ${contact}`);
  if (facts.length) {
    lines.push('', '## Facts', ...facts.map((fact) => `- ${fact}`));
  }
  return `${lines.join('\n')}\n`;
}

export const LLMS_NAME_NOTE = 'Replace <Your agency name> with the name you use.';

/** Organization JSON-LD. Name and description are included only when the page had them. */
export function organizationJsonLd(host: string, siteNameOrEvidence?: string | FixPackEvidence | null): string {
  const evidence = asEvidence(siteNameOrEvidence);
  const brand = brandNameFor(host, evidence.siteName);
  const clean = cleanHost(host);
  const description = oneLine(evidence.description);
  const body: Record<string, string> = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    url: `https://${clean}`,
  };
  if (brand) body.name = brand;
  if (description) body.description = description;
  return JSON.stringify(body, null, 2);
}

function slugPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'brand';
}

/**
 * Prepare-mode comparison page outline (/compare/<brand>-vs-<competitor>).
 * Pre-fills only facts from the audited domain and leaves competitor cells as explicit
 * verification placeholders so no rival claim or price is ever invented.
 */
export function comparisonOutlineDraft(
  host: string,
  siteNameOrEvidence?: string | FixPackEvidence | null,
  rivalName?: string | null,
): string {
  const evidence = asEvidence(siteNameOrEvidence);
  const clean = cleanHost(host);
  const brand = brandNameFor(host, evidence.siteName) || '<Your business name>';
  const rival = oneLine(rivalName) || '<Competitor>';
  const description = oneLine(evidence.description) || '<One-sentence summary of what you do>';
  const slug = `/compare/${slugPart(brand)}-vs-${slugPart(rival)}`;
  const faqSchema = JSON.stringify(
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: [
        {
          '@type': 'Question',
          name: `What is the main difference between ${brand} and ${rival}?`,
          acceptedAnswer: {
            '@type': 'Answer',
            text: `${rival} focuses on <verify their primary focus from their public site>. ${brand} focuses on ${description}`,
          },
        },
        {
          '@type': 'Question',
          name: `How does pricing compare between ${brand} and ${rival}?`,
          acceptedAnswer: {
            '@type': 'Answer',
            text: "Check both providers for current pricing. <Where you publish pricing, or 'Contact us for a quote'>.",
          },
        },
      ],
    },
    null,
    2,
  ).replace(/</g, '\\u003c');

  return [
    `<!-- Suggested URL path: ${slug} -->`,
    `<!-- Prepare mode: replace every <...> placeholder with facts verified on each vendor's public site. -->`,
    `# ${brand} vs ${rival}`,
    '',
    '## Short answer',
    `Choose ${rival} if you need <verify their strongest use case from their public site>. Choose ${brand} if you want ${description}`,
    '',
    '## Side by side',
    `| Dimension | ${rival} | ${brand} |`,
    '| --- | --- | --- |',
    `| Built for | <Verify target audience on ${rival} site> | <Your ideal customer profile> |`,
    `| Core offer | <Verify core offer on ${rival} site> | ${description} |`,
    `| Pricing model | <Verify pricing model without guessing numbers> | <Your pricing model> |`,
    `| Official site | <https://...> | https://${clean} |`,
    '',
    `## When to choose ${rival}`,
    `- <Verified strength 1 from ${rival}'s public documentation or pricing page>`,
    `- <Verified strength 2>`,
    '',
    `## When to choose ${brand}`,
    '- <Your primary differentiator backed by live evidence on your site>',
    `- Direct details at https://${clean}`,
    '',
    '## Common questions',
    `### What is the main difference between ${brand} and ${rival}?`,
    `${rival} focuses on <verify their primary focus from their public site>. ${brand} focuses on ${description}`,
    '',
    `### How does pricing compare between ${brand} and ${rival}?`,
    "Check both providers for current pricing. <Where you publish pricing, or 'Contact us for a quote'>.",
    '',
    '## FAQPage JSON-LD',
    '<!-- Do not publish until every \\u003c...> placeholder below is replaced with verified facts -->',
    '```html',
    '<script type="application/ld+json">',
    faqSchema,
    '</script>',
    '```',
    '',
  ].join('\n');
}

/**
 * Channel 1 (Editorial PR): Collaborative data study proposal + reactive journalist quote bank.
 * Prepare mode only: never invents study metrics or founder credentials.
 */
export function digitalPrStudyBriefDraft(
  host: string,
  siteNameOrEvidence?: string | FixPackEvidence | null,
  targetPublication?: string | null,
  rivalName?: string | null,
): string {
  const evidence = asEvidence(siteNameOrEvidence);
  const clean = cleanHost(host);
  const brand = brandNameFor(host, evidence.siteName) || '<Your business name>';
  const pub = oneLine(targetPublication) || '<Target publication domain>';
  const rival = oneLine(rivalName) || '<Competitor>';
  const description = oneLine(evidence.description) || '<One-sentence summary of your core expertise>';

  return [
    `<!-- Prepare mode: Digital PR & Co-Study Brief for ${pub} -->`,
    `<!-- Replace every <...> placeholder with verified internal data before outreach. -->`,
    `# Digital PR & Collaborative Data Study Pack: ${brand} x ${pub}`,
    '',
    '## Why this target matters',
    `AI search engines cite ${pub} when answering buyer prompts where ${rival} is named and ${brand} is absent.`,
    '',
    '## 1. Collaborative data study pitch',
    `- **Proposed headline:** <e.g. Regional cost and demand shifts in [Industry]: 12-month analysis by ${brand} and ${pub}>`,
    `- **Dataset ${brand} provides:** <Describe anonymised internal trend data, benchmark sample size, and date range>`,
    `- **Why ${pub} readers care:** Connects ${description} to seasonal buyer decisions without a sales pitch.`,
    '',
    '## 2. Reactive journalist expert quote template (60 words max)',
    `> "<Insert 2-sentence contrarian or practical insight backed by ${brand}'s field experience. Avoid promotional adjectives and state the concrete mechanism buyers should watch.>"`,
    `> - <Spokesperson Name>, <Role> at ${brand} (https://${clean})`,
    '',
    '## 3. Editor outreach draft (Prepare mode - review before sending)',
    `Subject: Data collaboration idea for ${pub}: <Topic hook>`,
    '',
    `Hi <Editor Name>,`,
    '',
    `I noticed ${pub}'s recent coverage on <Recent article topic>. At ${brand} (https://${clean}), we tracked <verified dataset description> across <time period> and found <1 verified non-promotional finding>.`,
    '',
    `Would you be open to an exclusive chart or co-branded data breakdown for ${pub} readers? Happy to share the raw methodology and a brief expert comment from <Spokesperson Name>.`,
    '',
    'Best,',
    '<Your Name>',
    '',
  ].join('\n');
}

/**
 * Channel 2 (Roundup Listicle): Drop-in product/service evaluation block + editor inclusion pitch.
 */
export function roundupInclusionPitchDraft(
  host: string,
  siteNameOrEvidence?: string | FixPackEvidence | null,
  targetSource?: string | null,
  rivalName?: string | null,
): string {
  const evidence = asEvidence(siteNameOrEvidence);
  const clean = cleanHost(host);
  const brand = brandNameFor(host, evidence.siteName) || '<Your business name>';
  const source = oneLine(targetSource) || '<Cited roundup article domain>';
  const rival = oneLine(rivalName) || '<Competitor>';
  const description = oneLine(evidence.description) || '<One-sentence summary of what you do>';

  return [
    `<!-- Prepare mode: Third-Party Roundup Inclusion Pack for ${source} -->`,
    `# Roundup Placement Pack: ${brand} on ${source}`,
    '',
    '## Why this target matters',
    `Answer engines pull recommendations from third-party comparison roundups on ${source} (currently naming ${rival}).`,
    '',
    '## 1. Drop-in roundup entry (formatted for editor updates)',
    `### ${brand} - Best for <Specific buyer use case>`,
    `- **Official URL:** https://${clean}`,
    `- **Core offer:** ${description}`,
    `- **Key specification 1:** <Verified spec or turnaround metric>`,
    `- **Key specification 2:** <Verified pricing tier or guarantee>`,
    `- **Pros:** <Verified strength 1>; <Verified strength 2>`,
    `- **Cons:** <Honest limitation so the review reads credibly>`,
    `- **Verdict:** Choose ${brand} when you need <specific differentiation vs ${rival}>.`,
    '',
    '## 2. Roundup editor update note (Prepare mode)',
    `Subject: Quick spec update for your <Article Title> roundup on ${source}`,
    '',
    `Hi <Author/Editor Name>,`,
    '',
    `Your guide on ${source} is one of the top references for buyers comparing ${rival} and alternatives. If you are refreshing the lineup for 2026, ${brand} (https://${clean}) fills the <specific use-case gap> slot.`,
    '',
    `I included our verified specs and a test/review access offer above in your exact roundup format in case it saves you research time.`,
    '',
    'Best,',
    '<Your Name>',
    '',
  ].join('\n');
}

/**
 * Channel 3 (Review Velocity & Social Proof): Guideline-safe /review landing page + QR card + post-service email.
 */
export function reviewFunnelPackDraft(
  host: string,
  siteNameOrEvidence?: string | FixPackEvidence | null,
  targetReviewPlatform?: string | null,
): string {
  const evidence = asEvidence(siteNameOrEvidence);
  const clean = cleanHost(host);
  const brand = brandNameFor(host, evidence.siteName) || '<Your business name>';
  const platform = oneLine(targetReviewPlatform) || 'Trustpilot / Google Reviews';

  return [
    `<!-- Suggested URL path: https://${clean}/review -->`,
    `<!-- Guideline compliance: invite all customers equally. Never gate reviews by sentiment or offer prohibited incentives. -->`,
    `# Compliant Review Velocity Funnel: ${brand}`,
    '',
    '## 1. Public /review landing page copy',
    `### Share your experience with ${brand}`,
    `Your feedback helps future customers and independent search tools understand what it is like to work with ${brand}. Pick your preferred platform below (takes under 60 seconds):`,
    `- **Leave a review on ${platform}:** <https://... direct verified profile link>`,
    `- **Leave a Google Business Profile review:** <https://... direct GBP review link>`,
    `- **Need support first?** Contact us directly at ${oneLine(evidence.contactUrl) || `https://${clean}/contact`}`,
    '',
    '## 2. Printable post-service handout card (QR target)',
    `- **Headline:** How did ${brand} do?`,
    `- **Body:** Scan the QR code to visit **https://${clean}/review** and share an honest review of your experience.`,
    `- **QR target URL:** https://${clean}/review`,
    '',
    '## 3. Automated post-completion follow-up email (Prepare mode)',
    `Subject: How was your experience with ${brand}?`,
    '',
    `Hi <Customer First Name>,`,
    '',
    `Thank you for working with ${brand}. Because most buyers research independent reviews before choosing a provider, we would be grateful if you shared an honest 2-sentence review of your experience:`,
    '',
    `https://${clean}/review`,
    '',
    `Thank you for your time,`,
    `<Your Name> at ${brand}`,
    '',
  ].join('\n');
}

/**
 * Channel 4 (Community & Forums): Zero-spam expert participation draft + customer issue triage.
 */
export function communityRadarDraft(
  host: string,
  siteNameOrEvidence?: string | FixPackEvidence | null,
  targetCommunity?: string | null,
): string {
  const evidence = asEvidence(siteNameOrEvidence);
  const clean = cleanHost(host);
  const brand = brandNameFor(host, evidence.siteName) || '<Your business name>';
  const community = oneLine(targetCommunity) || 'reddit.com';
  const description = oneLine(evidence.description) || '<your domain area>';

  return [
    `<!-- Prepare mode: Community & Forum Participation Draft for ${community} -->`,
    `<!-- Anti-spam rule: never use anonymous sockpuppets or drop bare promotional links. Lead with technical substance. -->`,
    `# Community Conversation & Reputation Pack: ${brand} on ${community}`,
    '',
    '## 1. Expertise-first thread reply draft (zero-spam)',
    `Disclosure: I work on ${brand} (${description}), sharing how we handle this in practice:`,
    '',
    `- **Direct answer to the OP's question:** <Give the concrete 3-step technical or buyer solution that works even if they never buy from you>`,
    `- **Tradeoff to watch out for:** <Explain the main edge case or hidden cost in this category>`,
    `- **How to verify:** <Independent check the reader can run themselves>`,
    '',
    '## 2. Customer issue resolution reply (when a thread flags a problem)',
    `Hi <Username> - <Your Name> from ${brand} here. Thank you for flagging this. <Acknowledge the exact issue without defensiveness>. We have <state concrete fix or direct support escalation path at https://${clean}> so we can resolve this for you today.`,
    '',
  ].join('\n');
}

/**
 * Dispatches the appropriate off-site brand mention Prepare pack for the detected channel.
 */
export function offSiteMentionPackDraft(opts: {
  host: string;
  siteNameOrEvidence?: string | FixPackEvidence | null;
  channel: OffSiteMentionChannel;
  targetHubDomain?: string | null;
  rivalName?: string | null;
}): string {
  switch (opts.channel) {
    case 'editorial_pr':
      return digitalPrStudyBriefDraft(opts.host, opts.siteNameOrEvidence, opts.targetHubDomain, opts.rivalName);
    case 'roundup_listicle':
      return roundupInclusionPitchDraft(opts.host, opts.siteNameOrEvidence, opts.targetHubDomain, opts.rivalName);
    case 'review_platform':
      return reviewFunnelPackDraft(opts.host, opts.siteNameOrEvidence, opts.targetHubDomain);
    case 'community_forum':
      return communityRadarDraft(opts.host, opts.siteNameOrEvidence, opts.targetHubDomain);
  }
}
