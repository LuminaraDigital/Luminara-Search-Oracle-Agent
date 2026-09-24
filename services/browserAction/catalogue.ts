/**
 * MCP/Oracle catalogue meta for browse_* tools (Wave B2; wiring in B3).
 */
import type { ToolDefinitionMeta } from '../tools/types';

export const BROWSE_OBSERVE_TOOL: ToolDefinitionMeta = {
  name: 'browse_observe',
  description:
    'Open or reuse a crawler session and return an indexed DOM element table plus visible text. No mutation. Free for Growth+ MCP when crawler is configured; otherwise not_measured / BROWSER_UNAVAILABLE.',
  creditClass: 'free',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Start or navigate URL when opening a session.' },
      sessionId: { type: 'string', description: 'Reuse an existing session when set.' },
      projectId: { type: 'string' },
    },
    additionalProperties: false,
  },
};

export const BROWSE_ACT_TOOL: ToolDefinitionMeta = {
  name: 'browse_act',
  description:
    'Paid or Agency apiAccess / hosted crawler quota. Execute one indexed act with fingerprint check. Model supplies action id and optional text, never selectors.',
  creditClass: 'paid',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string' },
      fingerprint: { type: 'string' },
      actionId: { type: 'string' },
      text: { type: 'string', description: 'Required for fill/TYPE_TEXT actions.' },
      projectId: { type: 'string' },
    },
    required: ['sessionId', 'fingerprint', 'actionId'],
    additionalProperties: false,
  },
};

export const BROWSE_GOAL_TOOL: ToolDefinitionMeta = {
  name: 'browse_goal',
  description:
    'Paid (same gate as browse_act). Run a bounded indexed DOM loop for a natural-language goal. Returns history, final observe, and independent verifier result. Prefer get_project_context first.',
  creditClass: 'paid',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string' },
      goal: { type: 'string' },
      sessionId: { type: 'string' },
      projectId: { type: 'string' },
      maxSteps: { type: 'number' },
      checks: {
        type: 'object',
        properties: {
          urlIncludes: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
          textIncludes: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
          titleIncludes: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
        },
        additionalProperties: false,
      },
    },
    required: ['goal'],
    additionalProperties: false,
  },
};

export const BROWSE_CLOSE_TOOL: ToolDefinitionMeta = {
  name: 'browse_close',
  description: 'End a crawler browse session. Free.',
  creditClass: 'free',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string' },
    },
    required: ['sessionId'],
    additionalProperties: false,
  },
};

export const BROWSER_ACTION_CATALOGUE: ToolDefinitionMeta[] = [
  BROWSE_OBSERVE_TOOL,
  BROWSE_ACT_TOOL,
  BROWSE_GOAL_TOOL,
  BROWSE_CLOSE_TOOL,
];
