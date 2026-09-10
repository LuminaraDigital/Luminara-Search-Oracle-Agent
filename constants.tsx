import React from 'react';

export const SYSTEM_INSTRUCTIONS = `
Role: You are Oracle Agent for Luminara Suite. You help founders see whether AI answers and Google mention their brand, then choose one fix worth shipping this week.

Emotional direction: Fog clearing at first light. Calm, clear, decisive. No theatre. No "neural core", holography, or fake document IDs.

Core rules:
1. Cite-or-silence: Ground every ranking, citation, or competitor claim in SERP / crawl evidence supplied in the prompt. If evidence is missing, write "not verified". Never invent ranks or scores.
2. Plain English is the default: Write at about an 8th-grade reading level. Short sentences. Explain schema, AI Overview, or citation in a few plain words the first time. Lead with what to do and why it matters to revenue.
3. One next move: Every audit must open with a single highest-priority ship action the founder can finish this week.
4. Economic sovereignty: Help founders win without a $10k/month agency retainer.
5. Business DNA: When Strategic Business DNA is provided, reinforce the USP and close gaps vs named competitors. When DNA is missing, label the run as a Quick Scout and keep recommendations general.

Protocols:
- Crawl and diagnose technical SEO, Core Web Vitals, and indexation as plain tasks with Impact Scores (1-100).
- AEO / AI visibility: ChatGPT, Gemini, Perplexity, AI Overviews. Propose answer-ready copy and JSON-LD when evidence supports it.
- ROI: Never invent percentages. Label estimates "(estimate)" and state the assumption.

Strict template (REQUIRED for audits):
# Luminara: Will AI mention [Business or Domain]?
**Date:** [Current Date] · **Mode:** [Full audit | Quick scout]

## 1. One move this week
[One concrete action. Why it helps you get cited. How to tell it worked.]

## 2. Plain verdict
[3 short sentences on what is working, what is missing, and the revenue risk.]

## 3. Fix list
| Task | Plain issue | Impact (1-100) | Priority |
|------|-------------|----------------|----------|
| [Task] | [Simple explanation] | [Score] | [High/Med/Low] |

## 4. Visibility radar
| Query | Intent | Brand cited | Competitors | Organic rank | AI Overview | Visibility (0-100) |
|-------|--------|-------------|-------------|--------------|-------------|--------------------|
| [Query] | [Intent] | [Yes/No/not verified] | [Names] | [Rank or not verified] | [Active/None/not verified] | [Score or not verified] |

## 5. Competitor map
| Brand | How AI talks about them | Pages that win citations | Trust signals |
|-------|-------------------------|--------------------------|---------------|
| [Yours] | ... | ... | Low/Med/High |
| [Rival] | ... | ... | Low/Med/High |

## 6. Budget notes (estimates only)
- Waste risk: [estimate + assumption]
- Lift if you ship the one move: [estimate + assumption]

## 7. Sources
[Only real URLs from grounding. If none, write: No live sources. Treat scores as not verified.]

---
*Luminara · fog clearing complete · ship the one move*
`;

export const GLOSSARY: Record<string, string> = {
  'SEO': 'Search Engine Optimization: The practice of increasing organic traffic to your website through search engine rankings.',
  'AEO': 'Answer Engine Optimization: Optimizing content to be chosen as direct answers by AI engines (Gemini, ChatGPT, Perplexity, Siri).',
  'GEO': 'Generative Engine Optimization: Techniques designed to maximize visibility and citations inside generative AI summaries and LLM syntheses.',
  'CTR': 'Click-Through Rate: The ratio of users who click on a link compared to the total users who viewed the page or impression.',
  'SCHEMA': 'Schema Markup: Structured vocabulary (JSON-LD) placed on a website to help search and AI engines understand entity relationships.',
  'BACKLINKS': 'Inbound links from external domains that search engines treat as citations of authority and trust.',
  'DOMAIN AUTHORITY': 'A search ranking metric that models the relative ranking power of an entire website domain.',
  'FEATURED SNIPPET': 'Highlighted search result appearing in a dedicated box at position zero on Google SERPs.',
  'JSON-LD': 'JavaScript Object Notation for Linked Data: The gold standard format for encoding Schema.org structured data.',
  'ORGANIC TRAFFIC': 'Unpaid visitors originating directly from search engine queries rather than paid advertising.',
  'META TITLES': 'HTML title elements signaling core topic relevancy to search engines and displayed in SERP link headers.',
  'RICH RESULTS': 'Enhanced search results featuring stars, FAQs, recipes, pricing, or sitelinks generated from structured data.',
  'KNOWLEDGE PANEL': 'Information cards appearing in Google search summarizing verified facts about organizations, people, or entities.',
  'CANONICAL TAG': 'An HTML tag declaring the master authoritative URL for duplicate or syndicated content.',
  'ALT TEXT': 'Descriptive alternative text for images utilized by screen readers and image-indexing AI crawlers.',
  'CORE WEB VITALS': 'Google standardized metrics measuring real-world user experience: loading performance (LCP), interactivity (INP), and visual stability (CLS).',
  'SLM': 'Small Language Model: A compact (20M-3B parameter) transformer engineered for low-latency edge inferencing, privacy preservation, and domain-specialized reasoning.',
  'GQA': 'Grouped Query Attention: An optimized attention architecture where multiple query heads share key-value heads, drastically reducing KV-cache memory bandwidth.',
  'ROPE': 'Rotary Position Embedding: Relative position encoding using complex coordinate rotation, enabling extended context reasoning without learned position parameters.',
  'SWIGLU': 'Swish-Gated Linear Unit: A state-of-the-art non-linear activation function combining gated feed-forward projections with SiLU activation.',
  'MOE': 'Mixture of Experts: Sparse neural architecture dynamically routing token embeddings to specialized expert sub-networks with zero extra FLOP overhead.',
  'LORA': 'Low-Rank Adaptation: Parameter-efficient fine-tuning (PEFT) that freezes base weights and trains low-rank decomposition matrices for rapid domain customization.',
  'DPO': 'Direct Preference Optimization: An alignment algorithm directly optimizing policy weights on chosen vs. rejected outputs without needing a separate reward model.',
  'GRPO': 'Group Relative Policy Optimization: DeepSeek-R1 style reinforcement learning calculating relative advantages across group rollouts and verifiable domain rewards.',
  'DISTILLATION': 'Knowledge Distillation: Transferring reasoning capacity from an advanced teacher model (e.g., Gemini 3 Pro) into a lightweight student SLM via softened logits.'
};

export const ICONS = {
  Sparkle: ({ className = "w-5 h-5" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
    </svg>
  ),
  Mic: ({ className = "w-5 h-5" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>
    </svg>
  ),
  Send: ({ className = "w-5 h-5" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="22" x2="11" y1="2" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
    </svg>
  ),
  Stop: ({ className = "w-5 h-5" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
    </svg>
  ),
  Search: ({ className = "w-5 h-5" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
    </svg>
  ),
  AlertCircle: ({ className = "w-5 h-5" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>
    </svg>
  ),
  List: ({ className = "w-5 h-5" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
    </svg>
  ),
  Copy: ({ className = "w-4 h-4" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>
  ),
  Check: ({ className = "w-4 h-4" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  ),
  FileText: ({ className = "w-4 h-4" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/>
      <line x1="10" y1="9" x2="8" y2="9"/>
    </svg>
  ),
  ChevronDown: ({ className = "w-4 h-4" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  ),
  ChevronUp: ({ className = "w-4 h-4" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="18 15 12 9 6 15"/>
    </svg>
  ),
  ChevronRight: ({ className = "w-4 h-4" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  ),
  Plus: ({ className = "w-4 h-4" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  ),
  Close: ({ className = "w-4 h-4" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
    </svg>
  ),
  Document: ({ className = "w-4 h-4" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/>
      <line x1="10" y1="9" x2="8" y2="9"/>
    </svg>
  ),
  Bookmark: ({ className = "w-4 h-4" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>
    </svg>
  ),
  BookOpen: ({ className = "w-4 h-4" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
    </svg>
  ),
  Help: ({ className = "w-4 h-4" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  ),
  Calendar: ({ className = "w-4 h-4" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  ),
  Table: ({ className = "w-4 h-4" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/>
    </svg>
  ),
  Info: ({ className = "w-4 h-4" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="16" y2="12"/><line x1="12" x2="12.01" y1="8" y2="8"/>
    </svg>
  ),
  ChartBar: ({ className = "w-4 h-4" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/>
    </svg>
  ),
  X: ({ className = "w-4 h-4" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
    </svg>
  ),
  Radar: ({ className = "w-5 h-5" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/><line x1="12" x2="22" y1="12" y2="12"/>
    </svg>
  ),
  Calculator: ({ className = "w-5 h-5" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect width="16" height="20" x="4" y="2" rx="2"/><line x1="8" x2="16" y1="6" y2="6"/><line x1="16" x2="16" y1="14" y2="18"/><path d="M16 10h.01"/><path d="M12 10h.01"/><path d="M8 10h.01"/><path d="M12 14h.01"/><path d="M8 14h.01"/><path d="M12 18h.01"/><path d="M8 18h.01"/>
    </svg>
  ),
  Stress: ({ className = "w-5 h-5" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 2v20"/><path d="m4.93 4.93 14.14 14.14"/><path d="M2 12h20"/><path d="m4.93 19.07 14.14-14.14"/>
    </svg>
  ),
  Analyst: ({ className = "w-5 h-5" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="12" x2="12" y1="20" y2="10"/><line x1="18" x2="18" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="16"/>
    </svg>
  ),
  Organizer: ({ className = "w-5 h-5" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>
    </svg>
  ),
  Research: ({ className = "w-5 h-5" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/>
    </svg>
  ),
  Chat: ({ className = "w-5 h-5" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  ),
  Live: ({ className = "w-5 h-5" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M2 10v3"/><path d="M6 6v11"/><path d="M10 3v18"/><path d="M14 8v7"/><path d="M18 5v13"/><path d="M22 10v3"/>
    </svg>
  ),
  Shield: ({ className = "w-5 h-5" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  ),
  DNA: ({ className = "w-5 h-5" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m8 3 4 8 5-5 5 15H2L8 3z"/>
    </svg>
  ),
  Settings: ({ className = "w-5 h-5" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  ),
  ExternalLink: ({ className = "w-4 h-4" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" x2="21" y1="14" y2="3"/>
    </svg>
  ),
  Refresh: ({ className = "w-4 h-4" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>
    </svg>
  ),
  Terminal: ({ className = "w-4 h-4" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>
    </svg>
  ),
  LuminaraLogo: ({ className = "w-10 h-10", isThinking, isVoice }: { className?: string; isThinking?: boolean; isVoice?: boolean }) => (
    <div className={`relative flex items-center justify-center ${className} ${isThinking ? 'logo-thinking' : ''} ${isVoice ? 'logo-voice' : ''} interactive-logo`}>
        <svg viewBox="0 0 100 100" className="w-full h-full">
            <defs>
                <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" style={{stopColor:'#BF953F'}} />
                    <stop offset="50%" style={{stopColor:'#FCF6BA'}} />
                    <stop offset="100%" style={{stopColor:'#AA771C'}} />
                </linearGradient>
                <radialGradient id="thinkingGlow" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
                    <stop offset="0%" style={{stopColor:'#FCF6BA', stopOpacity: 1}} />
                    <stop offset="40%" style={{stopColor:'#BF953F', stopOpacity: 0.8}} />
                    <stop offset="100%" style={{stopColor:'#AA771C', stopOpacity: 0}} />
                </radialGradient>
                <filter id="glow">
                  <feGaussianBlur stdDeviation="2.5" result="coloredBlur"/>
                  <feMerge>
                    <feMergeNode in="coloredBlur"/>
                    <feMergeNode in="SourceGraphic"/>
                  </feMerge>
                </filter>
            </defs>
            <circle cx="50" cy="50" r="48" fill="url(#goldGrad)" opacity="0.05" />
            {isVoice && (
              <circle cx="50" cy="50" r="46" fill="none" stroke="url(#goldGrad)" strokeWidth="0.5" strokeDasharray="1 3" className="animate-[spin_3s_linear_infinite]" opacity="0.6" />
            )}
            <g className="logo-orbit">
              <ellipse cx="50" cy="50" rx="42" ry="12" fill="none" stroke="url(#goldGrad)" strokeWidth="0.7" transform="rotate(45, 50, 50)" opacity="0.6" />
              <ellipse cx="50" cy="50" rx="42" ry="12" fill="none" stroke="url(#goldGrad)" strokeWidth="0.7" transform="rotate(-45, 50, 50)" opacity="0.6" />
              <ellipse cx="50" cy="50" rx="42" ry="12" fill="none" stroke="url(#goldGrad)" strokeWidth="0.7" transform="rotate(90, 50, 50)" opacity="0.4" />
            </g>
            <circle cx="50" cy="50" r="35" fill="none" stroke="url(#goldGrad)" strokeWidth="0.3" strokeDasharray="10 5" opacity="0.2" className="animate-[spin_12s_linear_infinite]" />
            <circle cx="50" cy="50" r="28" fill="none" stroke="url(#goldGrad)" strokeWidth="0.2" opacity="0.3" />
            <g className="logo-core" filter="url(#glow)">
              {isThinking && (
                <circle cx="50" cy="50" r="22" fill="url(#thinkingGlow)" opacity="0.3" className="animate-pulse" />
              )}
              <circle cx="50" cy="50" r="16" fill="url(#goldGrad)" opacity="0.15" />
              <circle cx="50" cy="50" r="10" fill="url(#goldGrad)" opacity="0.8" />
              <circle cx="50" cy="50" r="5" fill="#FCF6BA" />
              {(isThinking || isVoice) && (
                <circle cx="50" cy="50" r="12" fill="url(#goldGrad)" opacity="0.5" className="animate-pulse" />
              )}
            </g>
            <path d="M50 20 L50 80 M20 50 L80 50" stroke="url(#goldGrad)" strokeWidth="0.1" opacity="0.2" />
        </svg>
    </div>
  ),
  TimeSeries: ({ className = "w-5 h-5" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 3v18h18" />
      <path d="m7 15 4-4 4 4 6-6" />
      <circle cx="7" cy="15" r="1.5" fill="currentColor" />
      <circle cx="11" cy="11" r="1.5" fill="currentColor" />
      <circle cx="15" cy="15" r="1.5" fill="currentColor" />
      <circle cx="21" cy="9" r="1.5" fill="currentColor" />
    </svg>
  ),
  TrendUp: ({ className = "w-5 h-5" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
      <polyline points="16 7 22 7 22 13" />
    </svg>
  ),
  Activity: ({ className = "w-5 h-5" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  ),
  Notebook: ({ className = "w-5 h-5" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z" />
      <path d="M6 6h10" />
      <path d="M6 10h10" />
      <path d="M6 14h6" />
    </svg>
  ),
  Podcast: ({ className = "w-5 h-5" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="11" r="1" />
      <path d="M4.9 4.9a10 10 0 0 1 14.2 0" />
      <path d="M7.8 7.8a6 6 0 0 1 8.4 0" />
      <circle cx="12" cy="12" r="2" />
      <path d="M12 14v8" />
    </svg>
  ),
  Sliders: ({ className = "w-5 h-5" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="4" x2="4" y1="21" y2="14" />
      <line x1="4" x2="4" y1="10" y2="3" />
      <line x1="12" x2="12" y1="21" y2="12" />
      <line x1="12" x2="12" y1="8" y2="3" />
      <line x1="20" x2="20" y1="21" y2="16" />
      <line x1="20" x2="20" y1="12" y2="3" />
      <line x1="1" x2="7" y1="14" y2="14" />
      <line x1="9" x2="15" y1="8" y2="8" />
      <line x1="17" x2="23" y1="16" y2="16" />
    </svg>
  ),
  Zap: ({ className = "w-5 h-5" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  ),
  Share: ({ className = "w-5 h-5" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" x2="15.42" y1="13.51" y2="17.49" /><line x1="15.41" x2="8.59" y1="6.51" y2="10.49" />
    </svg>
  ),
  AlertTriangle: ({ className = "w-5 h-5" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><line x1="12" x2="12" y1="9" y2="13" /><line x1="12" x2="12.01" y1="17" y2="17" />
    </svg>
  ),
  Brain: ({ className = "w-5 h-5" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-2.04Z" />
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-2.04Z" />
    </svg>
  ),
  Cpu: ({ className = "w-5 h-5" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" /><path d="M15 2v2" /><path d="M15 20v2" /><path d="M2 15h2" /><path d="M2 9h2" /><path d="M20 15h2" /><path d="M20 9h2" /><path d="M9 2v2" /><path d="M9 20v2" />
    </svg>
  ),
  Layers: ({ className = "w-5 h-5" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  ),
  Network: ({ className = "w-5 h-5" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="16" y="16" width="6" height="6" rx="1" /><rect x="2" y="16" width="6" height="6" rx="1" /><rect x="9" y="2" width="6" height="6" rx="1" /><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3" /><path d="M12 12V8" />
    </svg>
  ),
  Flame: ({ className = "w-5 h-5" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </svg>
  ),
  Download: ({ className = "w-5 h-5" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" />
    </svg>
  ),
  CheckCircle: ({ className = "w-5 h-5" }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  )
};

export const TIMESFM_DEFAULT_COVARIATES = [
  {
    id: 'agency_reallocation',
    name: 'Retainer Reallocation Alpha',
    type: 'multiplier' as const,
    value: 1.25,
    active: false,
    description: 'Direct capital shift from monthly agency retainers into high-velocity programmatic content and entity authority (+25% compound lift).'
  },
  {
    id: 'google_core_shock',
    name: 'Google Core Update Turbulence',
    type: 'shock' as const,
    value: -0.18,
    active: false,
    description: 'Simulate search engine volatility (-18% temporary SERP re-ranking compression before quality recovery).'
  },
  {
    id: 'aeo_schema_saturation',
    name: 'AEO Entity Knowledge Graph Saturation',
    type: 'multiplier' as const,
    value: 1.38,
    active: true,
    description: 'Full JSON-LD structured schema deployment driving LLM quotation in Gemini, ChatGPT, and Perplexity (+38% citation expansion).'
  }
];

export const TIMESFM_BENCHMARKS = [
  {
    id: 'organic_search',
    name: 'Daily Organic Traffic (90 Days)',
    frequency: 'daily' as const,
    unit: 'Clicks / Day',
    description: 'Authentic 90-day search engine traffic exhibiting weekend seasonality dips, midweek peaks, and organic trend trajectory.',
    defaultHorizon: 30,
    generateData: () => {
      const data = [];
      const now = Date.now();
      const oneDay = 86400000;
      let base = 4200;
      for (let i = 89; i >= 0; i--) {
        const time = now - i * oneDay;
        const d = new Date(time);
        const dayOfWeek = d.getDay(); // 0 is Sun, 6 is Sat
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        const weekendFactor = isWeekend ? 0.72 : 1.08;
        
        // Slight monthly cycle
        const monthCycle = Math.sin((i / 30) * Math.PI * 2) * 280;
        
        // Google update shock around day 45
        let shock = 0;
        if (i >= 40 && i <= 50) {
          shock = -550;
        } else if (i < 40) {
          shock = 400 * (1 - i / 40); // recovery and lift
        }
        
        // Drift upwards
        const trend = (89 - i) * 14;
        const noise = (Math.sin(i * 3.7) + Math.cos(i * 1.9)) * 110;
        
        const value = Math.max(1200, Math.round(base + trend + monthCycle + shock + noise) * weekendFactor);
        data.push({
          timestamp: time,
          dateStr: d.toISOString().split('T')[0],
          value: Math.round(value)
        });
      }
      return data;
    }
  },
  {
    id: 'aeo_citations',
    name: 'AI Overview & AEO Citation Frequency (26 Weeks)',
    frequency: 'weekly' as const,
    unit: 'Weekly Citations',
    description: 'Weekly frequency of verified brand citations across Perplexity, Gemini AI Overviews, and ChatGPT Search.',
    defaultHorizon: 12,
    generateData: () => {
      const data = [];
      const now = Date.now();
      const oneWeek = 86400000 * 7;
      let base = 180;
      for (let i = 25; i >= 0; i--) {
        const time = now - i * oneWeek;
        const d = new Date(time);
        const growth = Math.pow(1.045, 25 - i) * base;
        const cycle = Math.sin(i * 0.8) * 35;
        const noise = (Math.sin(i * 2.3) * 20);
        const value = Math.max(80, Math.round(growth + cycle + noise));
        data.push({
          timestamp: time,
          dateStr: d.toISOString().split('T')[0],
          value
        });
      }
      return data;
    }
  },
  {
    id: 'cac_trajectory',
    name: 'Blended Customer Acquisition Cost (18 Months)',
    frequency: 'monthly' as const,
    unit: 'CAC ($)',
    description: 'Monthly blended CAC tracking efficiency gains as organic sovereign AEO presence displaces paid search dependence.',
    defaultHorizon: 6,
    generateData: () => {
      const data = [];
      const now = Date.now();
      const oneMonth = 86400000 * 30.4;
      let startCAC = 290;
      for (let i = 17; i >= 0; i--) {
        const time = now - i * oneMonth;
        const d = new Date(time);
        // Exponential decay towards asymptotic floor of $85
        const t = (17 - i) / 17;
        const decay = 290 - 180 * Math.pow(t, 0.7);
        const noise = (Math.cos(i * 1.5) * 12);
        const value = Math.max(70, Math.round(decay + noise));
        data.push({
          timestamp: time,
          dateStr: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
          value
        });
      }
      return data;
    }
  },
  {
    id: 'mrr_sovereign',
    name: 'Sovereign Recurring Revenue Runway (18 Months)',
    frequency: 'monthly' as const,
    unit: 'MRR ($)',
    description: 'Monthly Recurring Revenue expansion modeling zero-retainer agency elimination and automated organic customer pipeline.',
    defaultHorizon: 12,
    generateData: () => {
      const data = [];
      const now = Date.now();
      const oneMonth = 86400000 * 30.4;
      let mrr = 28000;
      for (let i = 17; i >= 0; i--) {
        const time = now - i * oneMonth;
        const d = new Date(time);
        const compound = 28000 * Math.pow(1.06, 17 - i);
        const noise = (Math.sin(i * 2.1) * 1200);
        const value = Math.round(compound + noise);
        data.push({
          timestamp: time,
          dateStr: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
          value
        });
      }
      return data;
    }
  }
];

