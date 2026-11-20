/**
 * Paid tool catalogue metadata (isomorphic; no Worker imports).
 */
import type { ToolDefinitionMeta } from './types';

export const PAID_TOOL_CATALOGUE: ToolDefinitionMeta[] = [
  {
    name: 'research_keywords',
    description:
      'Uses paid DataForSEO credits unless BYOK. Discover keyword ideas from up to 5 seed topics. Returns at most 20 rows. This is a sample, not a full export.',
    creditClass: 'paid',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        seeds: { type: 'array', items: { type: 'string' } },
      },
      required: ['projectId', 'seeds'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_domain_overview',
    description:
      'Uses paid DataForSEO credits unless BYOK. Returns a high-level rank overview for one domain.',
    creditClass: 'paid',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' }, domain: { type: 'string' } },
      required: ['projectId'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_serp_results',
    description:
      'Uses paid DataForSEO credits unless BYOK. SERP snapshot for one query. Returns at most 10 rows. This is a sample, not a ranked export.',
    creditClass: 'paid',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        query: { type: 'string' },
      },
      required: ['projectId', 'query'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_backlinks_overview',
    description:
      'Uses paid DataForSEO credits unless BYOK. Returns a backlink profile overview for one domain.',
    creditClass: 'paid',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' }, domain: { type: 'string' } },
      required: ['projectId'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_visibility_snapshot',
    description:
      'Uses paid credits when live. AI visibility snapshot (ChatGPT / AIO / Perplexity) with competitor missing-source discovery.',
    creditClass: 'paid',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        domain: { type: 'string' },
        brand: { type: 'string' },
        queries: { type: 'array', items: { type: 'string' } },
        competitors: { type: 'array', items: { type: 'string' } },
      },
      required: ['projectId'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_pagespeed_summary',
    description:
      'Uses paid credits. Returns Google PageSpeed Insights scores and Core Web Vitals (LCP, CLS, INP) for one URL, mobile by default. Says not_measured when PageSpeed returns no data.',
    creditClass: 'paid',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' }, url: { type: 'string' } },
      required: ['url'],
      additionalProperties: false,
    },
  },
];
