/**
 * get_guide: serves the Luminara workflow guides over MCP, so a host with no plugin
 * installed follows the same steps, at the version this server was built with.
 * Pattern from stablyai/orca (MIT): thin installed skill, guide fetched from the live tool.
 */
import type { McpToolDef } from './mcpServer';
import { MCP_GUIDES } from './mcpGuides.generated';

export const GUIDE_MCP_TOOLS: McpToolDef[] = [
  {
    name: 'get_guide',
    description:
      'Uses no credits. Step-by-step Luminara workflows (audit, keyword research, competitors, visibility, reports). Call with no topic to list them; read the matching guide before starting a task.',
    creditClass: 'free',
    inputSchema: {
      type: 'object',
      properties: { topic: { type: 'string', description: 'A topic from the list. Omit to list every guide.' } },
      additionalProperties: false,
    },
    handler: async (args) => {
      const topic = typeof args.topic === 'string' ? args.topic.trim() : '';
      if (!topic) {
        return {
          text: MCP_GUIDES.map((guide) => `- ${guide.topic}: ${guide.description}`).join('\n'),
          structuredContent: {
            guides: MCP_GUIDES.map(({ topic: name, description }) => ({ topic: name, description })),
          },
        };
      }
      const guide = MCP_GUIDES.find((entry) => entry.topic === topic);
      if (!guide) {
        return {
          text: `No guide named "${topic}".`,
          structuredContent: {
            code: 'NOT_FOUND',
            nextSteps: ['Call get_guide with no topic to list the guides, then pass one of those topics.'],
          },
          isError: true,
        };
      }
      return { text: guide.body, structuredContent: { topic: guide.topic, description: guide.description } };
    },
  },
];
