/**
 * The Oracle tool table (Blueprint section 3). Frozen at module load: nothing at run time
 * (tool arguments, prompts, skills, page text) can change a tool's effect or gate.
 * Tools live in ./tools; shared types in ./types.
 */
import { getLastAuditTool, getProjectContextTool, liveSearchTool } from './tools/read';
import { PAID_TOOLS } from './tools/paid';
import { createWatchTool, saveReportTool } from './tools/external';
import type { AgentTool, AgentToolContext } from './types';

export const AGENT_TOOLS: readonly AgentTool[] = Object.freeze(
  [getProjectContextTool, getLastAuditTool, liveSearchTool, ...PAID_TOOLS, saveReportTool, createWatchTool].map((tool) =>
    Object.freeze(tool),
  ),
);

const BY_NAME = new Map(AGENT_TOOLS.map((tool) => [tool.name, tool]));

export function agentToolByName(name: string): AgentTool | undefined {
  return BY_NAME.get(name);
}

/** Tools offered to the model for this context. Unattended runs see read, non-paid tools only. */
export function offeredTools(ctx: AgentToolContext): AgentTool[] {
  return AGENT_TOOLS.filter((tool) => !ctx.unattended || (tool.effect === 'read' && !tool.paid));
}
