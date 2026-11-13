import { governanceFor, type ToolRisk } from './mcpGovernance';

export const MCP_LIST_PAGE_MAX = 50;

/** Characters of report HTML or tool text returned on one MCP call. */
export const MCP_RESULT_TEXT_CAP = 32_000;

/** Structured tool payloads larger than this are replaced with a truncation marker. */
export const MCP_STRUCTURED_CHAR_CAP = 48_000;

const MCP_TOOL_TITLES: Record<string, string> = {
  whoami: 'Account and usage',
  list_projects: 'List projects',
  create_project: 'Create project',
  get_project_context: 'Read project context',
  get_project_history: 'Project history',
  compare_snapshots: 'Compare snapshots',
  get_project_outcomes: 'Project outcomes',
  mark_project_action_done: 'Mark an action done',
  get_project_monitor: 'Project check schedule',
  set_project_monitor: 'Set the check schedule',
  list_project_alerts: 'Project check alerts',
  ack_project_alert: 'Mark an alert read',
  update_project_context: 'Update project context',
  list_reports: 'List reports',
  get_report: 'Read a report',
  save_report: 'Save a report',
  research_keywords: 'Research keywords',
  get_domain_overview: 'Domain overview',
  get_serp_results: 'SERP snapshot',
  get_backlinks_overview: 'Backlink overview',
  get_visibility_snapshot: 'Visibility snapshot',
  get_pagespeed_summary: 'PageSpeed summary',
  browse_observe: 'Observe a page',
  browse_act: 'Act in the browser',
  browse_goal: 'Run a browser goal',
  browse_close: 'Close the browser',
  dream_status: 'Dreaming status',
  get_business_memory: 'Business memory',
  dream_consolidate: 'Consolidate memory',
  review_dream_proposal: 'Review a memory proposal',
  list_enquiries: 'List enquiries',
  ingest_enquiry: 'Record an enquiry',
  propose_booking_slots: 'Propose booking slots',
  decide_booking_signoff: 'Decide a booking',
  get_outcomes_funnel: 'Outcomes funnel',
  classify_cms_remediation: 'Classify a CMS fix',
  prepare_cms_mcp_call: 'Prepare a CMS call',
  create_dev_ticket_from_finding: 'Create a dev ticket',
  compile_review_to_skill: 'Compile a review into a skill',
  mint_habitat_token: 'Mint a habitat token',
  draft_fix: 'Draft a fix',
};

export type McpToolAnnotations = {
  title: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
};

export function mcpToolTitle(name: string): string {
  return MCP_TOOL_TITLES[name] ?? name.replaceAll('_', ' ');
}

export function mcpToolAnnotations(name: string): McpToolAnnotations {
  const risk: ToolRisk = governanceFor(name).risk;
  return {
    title: mcpToolTitle(name),
    readOnlyHint: risk === 'read',
    destructiveHint: risk === 'destructive',
  };
}

export function pageList<T>(
  items: readonly T[],
  args: Record<string, unknown>,
): { items: T[]; limit: number; truncated: boolean; nextCursor: string | null } {
  const requested = typeof args.limit === 'number' && Number.isFinite(args.limit) ? Math.trunc(args.limit) : MCP_LIST_PAGE_MAX;
  const limit = Math.min(MCP_LIST_PAGE_MAX, Math.max(1, requested));
  const parsed = typeof args.cursor === 'string' ? Number(args.cursor) : 0;
  const offset = Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
  const page = items.slice(offset, offset + limit);
  const next = offset + page.length;
  const truncated = next < items.length;
  return { items: page, limit, truncated, nextCursor: truncated ? String(next) : null };
}

/** Cuts on a UTF-16 code unit boundary without leaving a lone surrogate. */
export function clipText(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = max;
  const unit = text.charCodeAt(end - 1);
  if (unit >= 0xd800 && unit <= 0xdbff) end -= 1;
  return text.slice(0, Math.max(0, end));
}

export const MCP_PAGE_PROPERTIES = {
  limit: {
    type: 'integer',
    minimum: 1,
    maximum: MCP_LIST_PAGE_MAX,
    description: `Page size. The server caps this at ${MCP_LIST_PAGE_MAX}.`,
  },
  cursor: {
    type: 'string',
    description: 'Pass nextCursor from the previous page. Omit on the first page.',
  },
} as const;
