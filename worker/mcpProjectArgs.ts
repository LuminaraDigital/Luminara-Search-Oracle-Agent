/** Shared id check for free project MCP tools. */
export const MCP_PROJECT_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

export function requireProjectId(
  args: Record<string, unknown>,
  ctx: { credential: { projectId?: string | null } },
): string | null {
  const projectId = typeof args.projectId === 'string' ? args.projectId.trim() : '';
  if (!MCP_PROJECT_ID_RE.test(projectId)) return null;
  if (ctx.credential.projectId && ctx.credential.projectId !== projectId) return null;
  return projectId;
}
