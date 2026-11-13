/** What the Luminara MCP server tells a host about itself: identity, voice and protocol versions. */

/** What a host shows for this server: the Luminara name, mark and site. */
export function mcpServerInfo(origin: string) {
  return {
    name: 'luminara-mcp',
    title: 'Luminara Suite',
    version: '1.2.0',
    websiteUrl: origin,
    icons: [{ src: `${origin}/favicon-192.png`, mimeType: 'image/png', sizes: ['192x192'] }],
  };
}

/** Sent to the host's model on connect, so Luminara answers in its own voice wherever it is used. */
export const MCP_INSTRUCTIONS = [
  'You are connected to Luminara, the AI visibility and SEO suite at luminarasuite.com.',
  'Luminara keeps each project\'s context, audits and reports. Call whoami, then list_projects, then get_project_context before any other tool.',
  "Three named agents answer from stored records: ask_auditor (what was last found), ask_fixer (stored fix drafts), ask_coach (this week's one decision).",
  'Reply the Luminara way: lead with the verdict, give one next action, and link to the saved report instead of pasting it.',
  'Never present a number Luminara did not return; say "not measured" instead.',
  "A tool that needs the account owner's yes answers with an approval link. Give the user that link; do not retry until they approve.",
].join(' ');

/**
 * Newest first. 2025-11-25 stays off this list: that revision requires HTTP 403
 * when Origin is present and invalid, and this server does not check Origin.
 */
export const MCP_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;
/** Assumed when the client omits MCP-Protocol-Version. */
const MCP_PROTOCOL_VERSION_DEFAULT = '2025-03-26' satisfies (typeof MCP_PROTOCOL_VERSIONS)[number];

function isSupportedProtocolVersion(version: string): version is (typeof MCP_PROTOCOL_VERSIONS)[number] {
  return (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(version);
}

export function negotiateProtocolVersion(requested: unknown): (typeof MCP_PROTOCOL_VERSIONS)[number] {
  return typeof requested === 'string' && isSupportedProtocolVersion(requested)
    ? requested
    : MCP_PROTOCOL_VERSIONS[0];
}

/** Absent header assumes 2025-03-26. An explicit unsupported version is refused. */
export function hasSupportedProtocolHeader(request: Request): boolean {
  const raw = request.headers.get('mcp-protocol-version');
  return isSupportedProtocolVersion(raw === null ? MCP_PROTOCOL_VERSION_DEFAULT : raw.trim());
}
