/**
 * MCP Tool Definitions for the 4-Module Conversion Spine & CMS Fixer MCP Relay (0042).
 * Extracted from `worker/mcpServer.ts` to keep `mcpServer.ts` well below the 1,000-line ceiling.
 */

import type { McpToolDef, McpToolResult } from './mcpServer';
import {
  ingestInboundEnquiry,
  listProjectEnquiries,
} from './enquiryDeskService';
import {
  createBookingProposal,
  decideBookingAppointment,
  type ProposedBookingSlot,
} from './bookingApprovalService';
import { getProjectConversionFunnelSummary } from './outcomesLedgerService';
import {
  classifyRemediationTier,
  type RemediationFindingInput,
} from '../services/deployment/remediationTierRouter';
import {
  CMS_MCP_CONNECTOR_CATALOG,
  prepareCmsMcpRemediationCall,
  type CmsMcpConnectorId,
} from './cmsMcpRelay';
import type {
  EnquiryIntentType,
  EnquirySourceChannel,
} from '../services/enquiries/playbookQualificationService';

const VALID_FINDING_CATEGORIES = new Set<RemediationFindingInput['findingCategory']>([
  'schema_jsonld',
  'meta_tags',
  'llms_txt',
  'page_builder_layout',
  'cwv_performance',
  'ssr_hydration',
  'custom_crm_automation',
  'security_headers',
]);

function requireStr(args: Record<string, unknown>, key: string): string | null {
  const v = args[key];
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed.length ? trimmed : null;
}

function toTextResult(
  text: string,
  structuredContent?: Record<string, unknown>,
  isError?: boolean,
): McpToolResult {
  const base: McpToolResult = { text };
  if (structuredContent !== undefined) base.structuredContent = structuredContent;
  if (isError) base.isError = true;
  return base;
}

export const CONVERSION_SPINE_MCP_TOOLS: McpToolDef[] = [
  {
    name: 'list_enquiries',
    description: 'Uses no credits. Lists enquiries, SLA status, and evidence-bound qualification briefs for a project.',
    creditClass: 'free',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
      },
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const projectId = typeof args.projectId === 'string' && args.projectId.trim() ? args.projectId.trim() : 'default';
      const enquiries = await listProjectEnquiries(ctx.env, ctx.accountId, projectId);
      const lines = enquiries.length
        ? enquiries.map((e) => `- ${e.id}: ${e.contactName} [${e.intentType}] status=${e.status} paused=${Boolean(e.automationPaused)}`).join('\n')
        : 'No enquiries recorded yet.';
      return toTextResult(lines, { projectId, count: enquiries.length, enquiries });
    },
  },
  {
    name: 'ingest_enquiry',
    description: 'Uses no credits. Ingests an inbound real-estate or SME enquiry with Australian statutory valuation/legal guard and ClaimLedger brief extraction.',
    creditClass: 'free',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        fullName: { type: 'string' },
        email: { type: 'string' },
        phoneE164: { type: 'string' },
        propertyAddress: { type: 'string' },
        suburb: { type: 'string' },
        state: { type: 'string' },
        intentType: { type: 'string', enum: ['seller_appraisal', 'buyer_enquiry', 'landlord_management', 'general_sme'] },
        sourceChannel: { type: 'string', enum: ['web_widget', 'form_webhook', 'missed_call', 'meta_lead', 'portal_email', 'manual'] },
        initialMessage: { type: 'string' },
      },
      required: ['fullName', 'initialMessage'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const fullName = requireStr(args, 'fullName');
      const initialMessage = requireStr(args, 'initialMessage');
      if (!fullName || !initialMessage) {
        return toTextResult('fullName and initialMessage are required', undefined, true);
      }
      const res = await ingestInboundEnquiry(ctx.env, {
        accountId: ctx.accountId,
        projectId: typeof args.projectId === 'string' && args.projectId.trim() ? args.projectId.trim() : 'default',
        fullName,
        email: typeof args.email === 'string' ? args.email : undefined,
        phoneE164: typeof args.phoneE164 === 'string' ? args.phoneE164 : undefined,
        propertyAddress: typeof args.propertyAddress === 'string' ? args.propertyAddress : undefined,
        suburb: typeof args.suburb === 'string' ? args.suburb : undefined,
        state: typeof args.state === 'string' ? args.state : undefined,
        intentType: typeof args.intentType === 'string' ? (args.intentType as EnquiryIntentType) : 'seller_appraisal',
        sourceChannel: typeof args.sourceChannel === 'string' ? (args.sourceChannel as EnquirySourceChannel) : 'web_widget',
        initialMessage,
      });
      if (!res.ok) return toTextResult(res.error, undefined, true);
      const replyLine =
        res.evaluation.action === 'continue_playbook'
          ? `Suggested reply: ${res.evaluation.suggestedReply}`
          : `Escalation: ${res.evaluation.reason} (${res.evaluation.suggestedReply})`;
      return toTextResult(
        [
          `Enquiry ${res.enquiry.id}: status=${res.enquiry.status} (automationPaused=${Boolean(res.enquiry.automationPaused)})`,
          replyLine,
        ].join('\n'),
        { ...res },
      );
    },
  },
  {
    name: 'propose_booking_slots',
    description: 'Uses no credits. Proposes candidate appraisal or consultation slots requiring human agent sign-off.',
    creditClass: 'free',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        enquiryId: { type: 'string' },
        contactId: { type: 'string' },
        assignedAgentId: { type: 'string' },
        proposedSlots: { type: 'array', items: { type: 'object' } },
      },
      required: ['enquiryId', 'contactId', 'proposedSlots'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const enquiryId = requireStr(args, 'enquiryId');
      const contactId = requireStr(args, 'contactId');
      const proposedSlots = Array.isArray(args.proposedSlots)
        ? (args.proposedSlots as ProposedBookingSlot[])
        : [];
      if (!enquiryId || !contactId || proposedSlots.length === 0) {
        return toTextResult('enquiryId, contactId, and non-empty proposedSlots are required', undefined, true);
      }
      const res = await createBookingProposal(ctx.env, {
        accountId: ctx.accountId,
        projectId: typeof args.projectId === 'string' && args.projectId.trim() ? args.projectId.trim() : 'default',
        enquiryId,
        contactId,
        assignedAgentId: typeof args.assignedAgentId === 'string' ? args.assignedAgentId : 'agent_default',
        proposedSlots,
      });
      if (!res.ok) return toTextResult(res.error, undefined, true);
      return toTextResult(
        `Created appointment proposal ${res.appointment.id} (status=${res.appointment.approvalStatus}). Requires human sign-off.`,
        { appointment: res.appointment },
      );
    },
  },
  {
    name: 'decide_booking_signoff',
    description: 'Destructive/Human-gated. Approves or declines a proposed appraisal appointment after operator approval in the Sign-off Desk.',
    creditClass: 'free',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        appointmentId: { type: 'string' },
        decision: { type: 'string', enum: ['approve', 'decline'] },
        selectedSlotId: { type: 'string' },
        selectedSlotIso: { type: 'string' },
      },
      required: ['appointmentId', 'decision'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const appointmentId = requireStr(args, 'appointmentId');
      const decision = requireStr(args, 'decision');
      if (!appointmentId || (decision !== 'approve' && decision !== 'decline')) {
        return toTextResult('appointmentId and decision ("approve" | "decline") required', undefined, true);
      }
      const res = await decideBookingAppointment(ctx.env, {
        accountId: ctx.accountId,
        appointmentId,
        decision,
        actorUserId: ctx.user.id || ctx.accountId,
        selectedSlotId: typeof args.selectedSlotId === 'string' ? args.selectedSlotId : undefined,
        selectedSlotIso: typeof args.selectedSlotIso === 'string' ? args.selectedSlotIso : undefined,
      });
      if (!res.ok) return toTextResult(res.error, undefined, true);
      return toTextResult(
        `Appointment ${appointmentId} ${res.appointment.approvalStatus} (receipt: ${res.signoffReceiptId || 'declined'}).`,
        { appointment: res.appointment, signoffReceiptId: res.signoffReceiptId },
      );
    },
  },
  {
    name: 'get_outcomes_funnel',
    description: 'Uses no credits. Returns the 6-stage evidence-bound conversion funnel summary (measurementStatus: measured, revenueAttributionStatus: not_measured).',
    creditClass: 'free',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
      },
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const projectId = typeof args.projectId === 'string' && args.projectId.trim() ? args.projectId.trim() : 'default';
      const funnel = await getProjectConversionFunnelSummary(ctx.env, ctx.accountId, projectId);
      return toTextResult(
        `Conversion funnel for ${projectId}: enquiries=${funnel.countsByStage.enquiry_received}, qualified=${funnel.countsByStage.qualified_opportunity}, booked=${funnel.countsByStage.agent_approved_booking}, signed=${funnel.countsByStage.signed_listing} (revenueAttributionStatus=${funnel.revenueAttributionStatus})`,
        { funnel },
      );
    },
  },
  {
    name: 'classify_cms_remediation',
    description: 'Uses no credits. Classifies an audit finding into Tier 1 (Instant MCP), Tier 2 (Guided Builder / Squarespace Injection), or Tier 3 (Luminara Digital Engineering Brief).',
    creditClass: 'free',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string' },
        pageUrl: { type: 'string' },
        summary: { type: 'string' },
        findingTitle: { type: 'string' },
        findingCategory: {
          type: 'string',
          enum: [
            'schema_jsonld',
            'meta_tags',
            'llms_txt',
            'page_builder_layout',
            'cwv_performance',
            'ssr_hydration',
            'custom_crm_automation',
            'security_headers',
          ],
        },
        cmsPlatform: { type: 'string' },
        pageBuilderDetected: { type: 'string' },
        previousDeployBlocked: { type: 'boolean' },
      },
      required: ['domain', 'findingCategory'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const domain = requireStr(args, 'domain');
      const findingCategory = requireStr(args, 'findingCategory');
      if (!domain || !findingCategory) {
        return toTextResult('domain and findingCategory are required', undefined, true);
      }
      const summary =
        requireStr(args, 'summary') ||
        requireStr(args, 'findingTitle') ||
        `${findingCategory} remediation on ${domain}`;
      const typedCategory: RemediationFindingInput['findingCategory'] = VALID_FINDING_CATEGORIES.has(
        findingCategory as RemediationFindingInput['findingCategory'],
      )
        ? (findingCategory as RemediationFindingInput['findingCategory'])
        : 'schema_jsonld';
      const decision = classifyRemediationTier({
        domain,
        summary,
        findingCategory: typedCategory,
        cmsPlatform: typeof args.cmsPlatform === 'string' ? args.cmsPlatform : 'unknown',
        pageBuilderDetected: typeof args.pageBuilderDetected === 'string' ? args.pageBuilderDetected : null,
        previousDeployBlocked: Boolean(args.previousDeployBlocked),
      });
      return toTextResult(
        `Tier: ${decision.badgeLabel} (${decision.recommendedConnectors.join(', ') || 'Luminara Digital'}). ${decision.safetyRails.join(' ')}`,
        { decision },
      );
    },
  },
  {
    name: 'prepare_cms_mcp_call',
    description: 'Destructive/Human-gated. Validates and prepares a WordPress.com, GoBuildWP, Respira, InstaWP, Wix, or Squarespace remediation envelope.',
    creditClass: 'free',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        connectorId: { type: 'string' },
        toolName: { type: 'string' },
        domain: { type: 'string' },
        title: { type: 'string' },
        snapshotCreated: { type: 'boolean' },
        userConfirmed: { type: 'boolean' },
        pageMetaKeys: { type: 'array', items: { type: 'string' } },
        schemaJsonLd: { type: 'string' },
        parameters: { type: 'object' },
        payload: { type: 'object' },
      },
      required: ['connectorId', 'domain'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const connectorId = requireStr(args, 'connectorId');
      const domain = requireStr(args, 'domain');
      if (!connectorId || !(connectorId in CMS_MCP_CONNECTOR_CATALOG) || !domain) {
        return toTextResult('Valid connectorId and domain are required', undefined, true);
      }
      const typedConnector = connectorId as CmsMcpConnectorId;
      const projectId = typeof args.projectId === 'string' && args.projectId.trim() ? args.projectId.trim() : 'default';
      const rawParams =
        args.parameters && typeof args.parameters === 'object'
          ? (args.parameters as Record<string, unknown>)
          : args.payload && typeof args.payload === 'object'
            ? (args.payload as Record<string, unknown>)
            : {};
      const toolName = requireStr(args, 'toolName') || 'update_seo_metadata';
      const res = await prepareCmsMcpRemediationCall(ctx.env, {
        accountId: ctx.accountId,
        projectId,
        connectorId: typedConnector,
        domain,
        title: requireStr(args, 'title') || undefined,
        toolName,
        userConfirmed: typeof args.userConfirmed === 'boolean' ? args.userConfirmed : true,
        snapshotCreated: typeof args.snapshotCreated === 'boolean' ? args.snapshotCreated : true,
        pageMetaKeys: Array.isArray(args.pageMetaKeys)
          ? args.pageMetaKeys.filter((k): k is string => typeof k === 'string')
          : undefined,
        schemaJsonLd: typeof args.schemaJsonLd === 'string' ? args.schemaJsonLd : undefined,
        parameters: rawParams,
      });
      if (!res.body.ok) {
        return toTextResult(String(res.body.error || 'CMS MCP validation failed'), res.body, true);
      }
      return toTextResult(`Prepared verified MCP envelope for ${typedConnector}:${toolName}`, res.body);
    },
  },
];
