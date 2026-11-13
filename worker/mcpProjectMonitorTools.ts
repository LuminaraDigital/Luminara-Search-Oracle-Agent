/**
 * Free MCP tools for a project's check schedule and the alerts that schedule raised.
 */
import type { McpToolDef, McpToolResult } from './mcpServer';
import { getProject } from './projectService';
import {
  ackProjectAlert,
  getProjectMonitor,
  listProjectAlerts,
  saveProjectMonitor,
} from './projectMonitor';

function textResult(text: string, structured?: Record<string, unknown>, isError = false): McpToolResult {
  return { text, structuredContent: structured, isError };
}

const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

function requireProject(args: Record<string, unknown>, ctx: { credential: { projectId?: string | null } }): string | null {
  const projectId = typeof args.projectId === 'string' ? args.projectId.trim() : '';
  if (!ID_RE.test(projectId)) return null;
  if (ctx.credential.projectId && ctx.credential.projectId !== projectId) return null;
  return projectId;
}

export const PROJECT_MONITOR_MCP_TOOLS: McpToolDef[] = [
  {
    name: 'get_project_monitor',
    description:
      'Uses no credits. Returns the check schedule for one project: cadence, whether email is on, and the answer prompts built from the last page read. Prompts are not a measurement of AI answers.',
    creditClass: 'free',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' } },
      required: ['projectId'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const projectId = requireProject(args, ctx);
      if (!projectId) return textResult('Project not found', undefined, true);
      const project = await getProject(ctx.env, ctx.accountId, projectId);
      if (!project) return textResult('Project not found', undefined, true);
      const monitor = await getProjectMonitor(ctx.env, ctx.accountId, projectId);
      if (!monitor) return textResult('No check schedule yet.', { monitor: null });
      const prompts = monitor.prompts.length ? monitor.prompts.join('; ') : 'none built from the last page read';
      return textResult(
        `${monitor.enabled ? 'On' : 'Off'}, ${monitor.cadence}. Email ${monitor.emailOptIn ? 'on' : 'off'}. Prompts: ${prompts}.`,
        { monitor },
      );
    },
  },
  {
    name: 'set_project_monitor',
    description:
      'Uses no credits. Turns the project check schedule on or off. Cadence cannot be faster than the plan. emailOptIn must be true before any email is sent. Free and Starter stay on monthly.',
    creditClass: 'free',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        enabled: { type: 'boolean' },
        cadence: { type: 'string', enum: ['monthly', 'weekly', 'daily'] },
        emailOptIn: { type: 'boolean' },
      },
      required: ['projectId', 'enabled', 'cadence', 'emailOptIn'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const projectId = requireProject(args, ctx);
      if (!projectId || typeof args.enabled !== 'boolean' || typeof args.emailOptIn !== 'boolean' || typeof args.cadence !== 'string') {
        return textResult('Project not found', undefined, true);
      }
      const saved = await saveProjectMonitor(ctx.env, ctx.accountId, projectId, {
        enabled: args.enabled,
        cadence: args.cadence,
        emailOptIn: args.emailOptIn,
      });
      if (!saved.ok) return textResult(saved.error, undefined, true);
      return textResult(
        `${saved.monitor.enabled ? 'On' : 'Off'}, ${saved.monitor.cadence}. Email ${saved.monitor.emailOptIn ? 'on' : 'off'}.`,
        { monitor: saved.monitor },
      );
    },
  },
  {
    name: 'list_project_alerts',
    description:
      'Uses no credits. Lists check alerts for one project. A lift or a drop is included only when two stored snapshots share the same check series.',
    creditClass: 'free',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' } },
      required: ['projectId'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const projectId = requireProject(args, ctx);
      if (!projectId) return textResult('Project not found', undefined, true);
      const alerts = await listProjectAlerts(ctx.env, ctx.accountId, projectId);
      if (!alerts) return textResult('Project not found', undefined, true);
      if (!alerts.length) return textResult('No check alerts yet.', { alerts });
      return textResult(alerts.map((alert) => `${alert.kind}: ${alert.summary}`).join('\n'), { alerts });
    },
  },
  {
    name: 'ack_project_alert',
    description: 'Uses no credits. Marks one project check alert as read.',
    creditClass: 'free',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        alertId: { type: 'string' },
      },
      required: ['projectId', 'alertId'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const projectId = requireProject(args, ctx);
      const alertId = typeof args.alertId === 'string' ? args.alertId.trim() : '';
      if (!projectId || !ID_RE.test(alertId)) return textResult('Alert not found', undefined, true);
      const alert = await ackProjectAlert(ctx.env, ctx.accountId, projectId, alertId);
      if (!alert) return textResult('Alert not found', undefined, true);
      return textResult(`Read. ${alert.summary}`, { alert });
    },
  },
];
