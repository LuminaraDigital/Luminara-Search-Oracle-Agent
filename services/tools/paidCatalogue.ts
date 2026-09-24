/**
 * Paid tool catalogue metadata (isomorphic; no Worker imports).
 */
import type { ToolDefinitionMeta } from './types';

export const PAID_TOOL_CATALOGUE: ToolDefinitionMeta[] = [
  {
    name: 'research_keywords',
    description:
      'Uses paid DataForSEO credits unless BYOK. Discover keyword ideas from seed topics. Check research log first.',
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
      'Uses paid DataForSEO credits unless BYOK. High-level domain rank overview. Check research log first.',
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
      'Uses paid DataForSEO credits unless BYOK. SERP snapshot for a query. Check research log first.',
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
      'Uses paid DataForSEO credits unless BYOK. Backlink profile overview. Check research log first.',
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
      'Uses paid credits when live. AI visibility snapshot (ChatGPT / AIO / Perplexity). Returns not_measured until W4.',
    creditClass: 'paid',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' }, domain: { type: 'string' } },
      required: ['projectId'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_pagespeed_summary',
    description:
      'Uses paid credits when live. PageSpeed / CWV summary. Returns not_measured until W5 registry wiring.',
    creditClass: 'paid',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' }, url: { type: 'string' } },
      required: ['url'],
      additionalProperties: false,
    },
  },
];
