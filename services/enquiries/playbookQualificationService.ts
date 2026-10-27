/**
 * Playbook Qualification & Enquiry Governance Service
 *
 * Implements the deterministic and evidence-bound rules for Module B (Enquiry Desk):
 * 1. Approved real-estate (Seller, Buyer, Landlord) and SME qualification playbooks.
 * 2. Hard statutory and uncertainty escalation (Australian Real Estate Acts: never emit automated
 *    property price valuations or legal contract advice; escalate to a licensed agent).
 * 3. Instant opt-out / STOP detection for Australian Spam Act 2003 compliance.
 * 4. Evidence-bound Opportunity Brief generation backed by ClaimLedger (measured vs unknown).
 * 5. Rakazo-style deterministic ExternalEffect keys so retries never double-execute.
 */

import { ClaimLedger } from '../evidenceBound/claimLedger';
import type { Claim } from '../evidenceBound/types';
import { canonicalJson, sha256HexOf } from '../trust/receiptCrypto';

export type EnquiryIntentType =
  | 'seller_appraisal'
  | 'buyer_enquiry'
  | 'landlord_management'
  | 'general_sme';

export type EnquirySourceChannel =
  | 'web_widget'
  | 'form_webhook'
  | 'missed_call'
  | 'meta_lead'
  | 'portal_email'
  | 'manual';

export type EnquiryStatus =
  | 'new'
  | 'conversing'
  | 'qualified'
  | 'booking_proposed'
  | 'booked'
  | 'stalled'
  | 'closed';

export const OUTCOME_STAGES = [
  'enquiry_received',
  'two_way_conversation',
  'qualified_opportunity',
  'agent_approved_booking',
  'attended_appraisal',
  'signed_listing',
] as const;

export type OutcomeStage = (typeof OUTCOME_STAGES)[number];

export type OutcomeEvidenceType =
  | 'webhook_payload'
  | 'message_transcript_id'
  | 'qualification_brief_id'
  | 'agent_signoff_receipt'
  | 'staff_confirmation'
  | 'listing_url';

export interface PlaybookQuestion {
  fieldKey: string;
  label: string;
  questionPrompt: string;
  requiredForQualification: boolean;
}

export interface EnquiryPlaybook {
  id: EnquiryIntentType;
  name: string;
  description: string;
  defaultSlaMinutes: number;
  questions: PlaybookQuestion[];
  escalationRules: string[];
}

export interface ConversationMessage {
  id: string;
  sender: 'prospect' | 'assistant' | 'agent';
  text: string;
  timestamp: number;
}

export interface OpportunityBrief {
  intentType: EnquiryIntentType;
  playbookName: string;
  qualified: boolean;
  escalationRequired: boolean;
  escalationReason?: string;
  recordedAnswers: Record<string, { value: string; status: 'measured' | 'unknown'; messageId?: string }>;
  missingRequiredFields: string[];
  claims: Claim[];
  summaryVerdict: string;
  nextRecommendedAction: string;
}

export const APPROVED_PLAYBOOKS: Record<EnquiryIntentType, EnquiryPlaybook> = {
  seller_appraisal: {
    id: 'seller_appraisal',
    name: 'Seller Appraisal Qualification',
    description: 'Qualifies prospective property vendors and prepares a licensed agent appraisal booking.',
    defaultSlaMinutes: 15,
    questions: [
      {
        fieldKey: 'property_address',
        label: 'Property Address',
        questionPrompt: 'Which property address and suburb are you considering having appraised?',
        requiredForQualification: true,
      },
      {
        fieldKey: 'property_type',
        label: 'Property Type & Specs',
        questionPrompt: 'Is the property a house, apartment, townhouse, or land, and roughly how many bedrooms?',
        requiredForQualification: true,
      },
      {
        fieldKey: 'timeframe',
        label: 'Selling Timeframe',
        questionPrompt: 'What is your ideal timeframe for going to market or receiving an updated market appraisal?',
        requiredForQualification: true,
      },
      {
        fieldKey: 'preferred_contact',
        label: 'Preferred Contact & Callback Window',
        questionPrompt: 'What is the best phone number and time window for our licensed agent to confirm your appraisal?',
        requiredForQualification: false,
      },
    ],
    escalationRules: [
      'Never quote an estimated selling price, valuation range, or commission discount.',
      'Escalate immediately to a licensed agent if the prospect asks for a price estimate or legal contract review.',
    ],
  },
  buyer_enquiry: {
    id: 'buyer_enquiry',
    name: 'Buyer Inspection & Qualification',
    description: 'Handles listing enquiries, captures buyer criteria, and arranges inspection or callback bookings.',
    defaultSlaMinutes: 30,
    questions: [
      {
        fieldKey: 'target_property_or_suburb',
        label: 'Target Property or Suburb',
        questionPrompt: 'Which specific listing or suburb are you enquiring about today?',
        requiredForQualification: true,
      },
      {
        fieldKey: 'buying_timeframe',
        label: 'Purchase Timeframe & Readiness',
        questionPrompt: 'Are you looking to purchase immediately (with finance pre-approval in place) or researching the area?',
        requiredForQualification: true,
      },
      {
        fieldKey: 'inspection_preference',
        label: 'Inspection Availability',
        questionPrompt: 'Would you prefer to attend the next scheduled open home or request a private inspection callback?',
        requiredForQualification: true,
      },
    ],
    escalationRules: [
      'Never represent vendor reserve prices, unlisted offers, or building/pest warranties.',
      'Escalate offer submissions or contract amendments directly to the listing agent.',
    ],
  },
  landlord_management: {
    id: 'landlord_management',
    name: 'Property Management & Rental Appraisal',
    description: 'Qualifies residential or commercial landlords seeking leasing and property management.',
    defaultSlaMinutes: 20,
    questions: [
      {
        fieldKey: 'property_address',
        label: 'Investment Property Address',
        questionPrompt: 'What is the street address and suburb of the investment property?',
        requiredForQualification: true,
      },
      {
        fieldKey: 'occupancy_status',
        label: 'Current Tenancy Status',
        questionPrompt: 'Is the property currently vacant, owner-occupied, or managed by another agency?',
        requiredForQualification: true,
      },
      {
        fieldKey: 'timeframe',
        label: 'Management Start Timeframe',
        questionPrompt: 'When would you like rental management or a leasing appraisal to begin?',
        requiredForQualification: true,
      },
    ],
    escalationRules: [
      'Never guarantee rental yields, weekly rent figures, or tenancy tribunal outcomes without agent review.',
    ],
  },
  general_sme: {
    id: 'general_sme',
    name: 'SME Service Enquiry & Discovery Booking',
    description: 'Captures service area, scope, and urgency to book an approved consultation or callback.',
    defaultSlaMinutes: 30,
    questions: [
      {
        fieldKey: 'service_needed',
        label: 'Primary Service Required',
        questionPrompt: 'Which service or outcome are you looking for help with?',
        requiredForQualification: true,
      },
      {
        fieldKey: 'location_or_website',
        label: 'Location or Website',
        questionPrompt: 'What is your business website or suburb/service location?',
        requiredForQualification: true,
      },
      {
        fieldKey: 'timeframe',
        label: 'Project Timeframe',
        questionPrompt: 'How soon are you looking to get started or speak with a specialist?',
        requiredForQualification: true,
      },
    ],
    escalationRules: [
      'Never bind custom fixed-price quotes or SLA guarantees without human sign-off.',
    ],
  },
};

const OPT_OUT_PATTERNS: readonly RegExp[] = [
  /^\s*(stop|unsubscribe|opt\s*out|cancel|quit)\s*$/i,
  /\b(unsubscribe\s+me|remove\s+me\s+from\s+your\s+list|do\s+not\s+contact\s+me|stop\s+texting|stop\s+messaging)\b/i,
];

const STATUTORY_ESCALATION_PATTERNS: Array<{ reason: string; pattern: RegExp }> = [
  {
    reason: 'Statutory real estate rule: automated price valuations or appraisal estimates require a licensed agent.',
    pattern:
      /\b(how\s+much\s+is\s+(my|the)\s+(house|home|property|unit|land)\s+worth|what\s+price\s+can\s+(you|i)\s+get|price\s+estimate|instant\s+valuation|guaranteed\s+(price|rent|yield)|reserve\s+price)\b/i,
  },
  {
    reason: 'Legal or contract advice requested: requires human agent or conveyancer/solicitor review.',
    pattern:
      /\b(section\s+32|vendor\s+statement|cooling[\s-]off\s+waiver|trust\s+account\s+dispute|special\s+condition\s+clause|breach\s+of\s+contract)\b/i,
  },
  {
    reason: 'Prospect requested direct human agent intervention.',
    pattern: /\b(speak\s+to\s+a\s+(human|real\s+person|agent|manager)|call\s+me\s+now|stop\s+bot)\b/i,
  },
];

export type InboundTurnEvaluation =
  | {
      action: 'instant_unsubscribe';
      automationPaused: true;
      reason: string;
      suggestedReply: string;
    }
  | {
      action: 'escalate_to_agent';
      automationPaused: true;
      reason: string;
      suggestedReply: string;
    }
  | {
      action: 'continue_playbook';
      automationPaused: false;
      nextQuestion: PlaybookQuestion | null;
      suggestedReply: string;
    };

/**
 * Deterministically evaluates an inbound prospect message before any AI generation runs.
 * Enforces opt-out (Spam Act 2003), statutory real-estate valuation boundaries, and playbook progression.
 */
export function evaluateInboundEnquiryTurn(args: {
  intentType: EnquiryIntentType;
  inboundText: string;
  recordedAnswers: Record<string, string | undefined>;
  agencyName?: string;
}): InboundTurnEvaluation {
  const text = (args.inboundText || '').trim();
  const agencyLabel = (args.agencyName || 'our agency team').trim();

  for (const rx of OPT_OUT_PATTERNS) {
    if (rx.test(text)) {
      return {
        action: 'instant_unsubscribe',
        automationPaused: true,
        reason: 'Prospect sent an explicit opt-out / STOP instruction.',
        suggestedReply: `You have been unsubscribed from automated follow-ups from ${agencyLabel}. No further automated messages will be sent.`,
      };
    }
  }

  for (const rule of STATUTORY_ESCALATION_PATTERNS) {
    if (rule.pattern.test(text)) {
      return {
        action: 'escalate_to_agent',
        automationPaused: true,
        reason: rule.reason,
        suggestedReply: `Thank you for asking. Because accurate property pricing and contract guidance require a licensed specialist from ${agencyLabel}, I have flagged your enquiry for direct agent follow-up.`,
      };
    }
  }

  const playbook = APPROVED_PLAYBOOKS[args.intentType] ?? APPROVED_PLAYBOOKS.general_sme;
  const missingQuestion =
    playbook.questions.find((q) => {
      const val = args.recordedAnswers[q.fieldKey];
      return !val || !val.trim();
    }) ?? null;

  if (!missingQuestion) {
    return {
      action: 'continue_playbook',
      automationPaused: false,
      nextQuestion: null,
      suggestedReply: `Thank you - we have recorded your details for ${agencyLabel}. I have prepared an appraisal/callback request for agent sign-off and will confirm your booking time shortly.`,
    };
  }

  return {
    action: 'continue_playbook',
    automationPaused: false,
    nextQuestion: missingQuestion,
    suggestedReply: missingQuestion.questionPrompt,
  };
}

/**
 * Builds an Evidence-Bound Opportunity Brief from recorded answers and transcript messages.
 * Never fabricates missing fields: unrecorded fields remain `unknown`.
 */
export function buildOpportunityBrief(args: {
  intentType: EnquiryIntentType;
  answers: Record<string, { value?: string; messageId?: string }>;
  escalationReason?: string;
}): OpportunityBrief {
  const playbook = APPROVED_PLAYBOOKS[args.intentType] ?? APPROVED_PLAYBOOKS.general_sme;
  const ledger = new ClaimLedger();
  const recordedAnswers: OpportunityBrief['recordedAnswers'] = {};
  const missingRequiredFields: string[] = [];

  for (const q of playbook.questions) {
    const entry = args.answers[q.fieldKey] as { value?: string; status?: string; messageId?: string } | undefined;
    const cleanVal = entry?.value?.trim() || '';
    if (cleanVal && cleanVal !== 'unknown' && entry?.status !== 'unknown') {
      recordedAnswers[q.fieldKey] = {
        value: cleanVal,
        status: 'measured',
        messageId: entry?.messageId,
      };
      ledger.append({
        text: `${q.label}: ${cleanVal}`,
        status: 'measured',
        sources: [
          {
            kind: 'user',
            id: entry?.messageId ? `transcript:${entry.messageId}` : `field:${q.fieldKey}`,
            excerpt: cleanVal,
          },
        ],
      });
    } else {
      recordedAnswers[q.fieldKey] = {
        value: 'unknown',
        status: 'unknown',
      };
      if (q.requiredForQualification) {
        missingRequiredFields.push(q.fieldKey);
      }
      ledger.append({
        text: `${q.label}: unknown (not yet provided by prospect)`,
        status: 'unknown',
      });
    }
  }

  const escalationRequired = Boolean(args.escalationReason);
  const qualified = missingRequiredFields.length === 0 && !escalationRequired;

  const summaryVerdict = escalationRequired
    ? `Escalated to licensed agent: ${args.escalationReason}`
    : qualified
      ? `Qualified ${playbook.name} ready for agent-approved booking.`
      : `In progress: ${missingRequiredFields.length} required qualification field(s) remaining (${missingRequiredFields.join(', ')}).`;

  const nextRecommendedAction = escalationRequired
    ? 'Assign to licensed agent for direct callback and pause automated sequence.'
    : qualified
      ? 'Review candidate calendar slots and approve the appraisal/callback booking.'
      : `Ask prospect for ${missingRequiredFields[0]} using approved playbook prompt.`;

  return {
    intentType: playbook.id,
    playbookName: playbook.name,
    qualified,
    escalationRequired,
    escalationReason: args.escalationReason,
    recordedAnswers,
    missingRequiredFields,
    claims: [...ledger.list()],
    summaryVerdict,
    nextRecommendedAction,
  };
}

/**
 * Computes a deterministic Rakazo-style ExternalEffect key (`eff_<sha256_prefix>`)
 * so retried webhooks, outbound messages, bookings, or CMS mutations never execute twice.
 */
export async function computeExternalEffectKey(args: {
  accountId: string;
  projectId: string;
  targetSystem: string;
  actionKind: string;
  payload: unknown;
}): Promise<{ effectKey: string; payloadHash: string }> {
  const payloadHash = await sha256HexOf(canonicalJson(args.payload ?? null));
  const composite = canonicalJson({
    accountId: args.accountId,
    projectId: args.projectId,
    targetSystem: args.targetSystem,
    actionKind: args.actionKind,
    payloadHash,
  });
  const fullHash = await sha256HexOf(composite);
  return {
    effectKey: `eff_${fullHash.slice(0, 40)}`,
    payloadHash,
  };
}
