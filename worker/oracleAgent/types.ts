/**
 * Shared types for the Oracle tool loop. See README.md for the invariants they carry.
 */
import type { Env } from '../env';
import type { HostedIdentity } from '../userTypes';
import type { AgentLimits } from './limits';

/**
 * read: looks things up; runs inside the loop.
 * draft: writes inside Luminara only (a private report); runs inside the loop.
 * external: schedules recurring work or changes something outside Luminara; never runs inside the
 * loop, it becomes an approval card.
 */
export type ToolEffect = 'read' | 'draft' | 'external';

export type AgentToolContext = {
  env: Env;
  user: HostedIdentity;
  accountId: string;
  /** The chat's project, only when the signed-in account owns it. */
  projectId: string | null;
  /** That project's domain, read once when the context is built. */
  projectDomain: string | null;
  plan: string;
  /** Agency apiAccess or a BYOK DataForSEO credential. */
  canUsePaid: boolean;
  dfsCred: string | null;
  runId: string | null;
  limits: AgentLimits;
  /** Unattended runs get read tools only, never paid or external. */
  unattended: boolean;
  /** Mutable per-turn state. */
  state: { contextLoaded: boolean; paidCalls: number };
};

export type ToolSource = { url: string; title: string };

export type ToolOutcome = {
  /** Text handed back to the model (fenced by the loop). */
  text: string;
  isError: boolean;
  /** True only for a structured measurement (never for search snippets). */
  measured: boolean;
  /** The user's own stored data (project context): its figures are the user's, not invented. */
  userProvided?: boolean;
  sources: ToolSource[];
  /** Code-built one-line receipt summary. Never model prose. */
  summary: string;
};

export type ExternalPreparation =
  | { ok: true; args: Record<string, unknown>; preview: string; costNote: string }
  | { ok: false; error: string };

export type AgentTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  effect: ToolEffect;
  paid: boolean;
  /** Plain status line shown before the call ("Searching live sources"). */
  status: string;
  /** null when allowed, otherwise the reason the model is given. */
  gate: (ctx: AgentToolContext) => Promise<string | null> | string | null;
  /** read and draft tools. */
  run?: (args: Record<string, unknown>, ctx: AgentToolContext) => Promise<ToolOutcome>;
  /** external tools: validate and build the code-rendered preview, before the card. */
  prepare?: (args: Record<string, unknown>, ctx: AgentToolContext) => Promise<ExternalPreparation>;
  /** external tools: run once, after approval, with the stored args. */
  execute?: (args: Record<string, unknown>, ctx: AgentToolContext) => Promise<ToolOutcome>;
};

/** A tool outcome with the usual defaults: not an error, not measured, no sources. */
export function outcome(text: string, summary: string, extra: Partial<ToolOutcome> = {}): ToolOutcome {
  return { text, summary, isError: false, measured: false, sources: [], ...extra };
}

export function errorOutcome(text: string, summary: string): ToolOutcome {
  return outcome(text, summary, { isError: true });
}

export function str(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function needsProject(ctx: AgentToolContext): string | null {
  return ctx.projectId ? null : 'No project is open in this chat. Ask the user to open or create a project first.';
}
