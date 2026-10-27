import React, { useEffect, useState } from 'react';
import {
  APPROVED_PLAYBOOKS,
  buildOpportunityBrief,
  evaluateInboundEnquiryTurn,
  OUTCOME_STAGES,
  type EnquiryIntentType,
  type OutcomeStage,
} from '../../services/enquiries/playbookQualificationService';
import {
  appendEnquiryTurnApi,
  decideBookingAppointmentApi,
  fetchEnquiryDesk,
  ingestEnquiryApi,
  proposeBookingSlotsApi,
  recordOutcomeStageApi,
  sendRecoveryStepApi,
  setEnquiryTakeoverApi,
  syncEnquiryToTwentyApi,
} from '../../services/enquiries/enquiryApiClient';

export interface LocalEnquiryItem {
  id: string;
  fullName: string;
  contactDetail: string;
  propertyAddress: string;
  intentType: EnquiryIntentType;
  status: 'new' | 'conversing' | 'qualified' | 'booking_proposed' | 'booked' | 'closed';
  automationPaused: boolean;
  slaDueAt: number;
  answers: Record<string, { value?: string; messageId?: string }>;
  escalationReason?: string;
  proposedSlotLabel?: string;
  appointmentId?: string;
  bookingApprovedBy?: string;
}

const STORAGE_ENQUIRIES_KEY = 'conversion_spine:enquiries';
const STORAGE_STAGE_COUNTS_KEY = 'conversion_spine:stage_counts';

const STAGE_LABELS: Record<OutcomeStage, string> = {
  enquiry_received: '1. Enquiry Received',
  two_way_conversation: '2. Two-Way Chat',
  qualified_opportunity: '3. Qualified Brief',
  agent_approved_booking: '4. Approved Booking',
  attended_appraisal: '5. Attended Appraisal',
  signed_listing: '6. Signed Listing',
};

function createInitialEnquiries(): LocalEnquiryItem[] {
  return [
    {
      id: 'enq_demo_seller_1',
      fullName: 'Sarah Jenkins',
      contactDetail: '+61 412 555 019',
      propertyAddress: '42 Oceanview Parade, Mosman NSW 2088',
      intentType: 'seller_appraisal',
      status: 'booking_proposed',
      automationPaused: false,
      slaDueAt: Date.now() + 12 * 60_000,
      answers: {
        property_address: { value: '42 Oceanview Parade, Mosman NSW 2088', messageId: 'msg_1' },
        property_type: { value: '4-bedroom freestanding residence', messageId: 'msg_2' },
        timeframe: { value: 'Planning spring campaign within 6 weeks', messageId: 'msg_3' },
      },
      proposedSlotLabel: 'Thu 10:30 AM AEST - In-Person Market Appraisal',
    },
  ];
}

export const EnquiryDeskView: React.FC = () => {
  const [enquiries, setEnquiries] = useState<LocalEnquiryItem[]>(() => {
    if (typeof window === 'undefined') return createInitialEnquiries();
    try {
      const raw = localStorage.getItem(STORAGE_ENQUIRIES_KEY);
      return raw ? (JSON.parse(raw) as LocalEnquiryItem[]) : createInitialEnquiries();
    } catch {
      return createInitialEnquiries();
    }
  });

  const [stageCounts, setStageCounts] = useState<Record<OutcomeStage, number>>(() => {
    const fallback: Record<OutcomeStage, number> = {
      enquiry_received: 1,
      two_way_conversation: 1,
      qualified_opportunity: 1,
      agent_approved_booking: 0,
      attended_appraisal: 0,
      signed_listing: 0,
    };
    if (typeof window === 'undefined') return fallback;
    try {
      const raw = localStorage.getItem(STORAGE_STAGE_COUNTS_KEY);
      return raw ? { ...fallback, ...(JSON.parse(raw) as Record<OutcomeStage, number>) } : fallback;
    } catch {
      return fallback;
    }
  });

  const [selectedId, setSelectedId] = useState<string>(enquiries[0]?.id || '');
  const [newFullName, setNewFullName] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newIntent, setNewIntent] = useState<EnquiryIntentType>('seller_appraisal');
  const [newMessage, setNewMessage] = useState('');
  const [followUpText, setFollowUpText] = useState('');
  const [twentyBaseUrl, setTwentyBaseUrl] = useState('');
  const [twentyApiKey, setTwentyApiKey] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [feedbackBanner, setFeedbackBanner] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_ENQUIRIES_KEY, JSON.stringify(enquiries));
      localStorage.setItem(STORAGE_STAGE_COUNTS_KEY, JSON.stringify(stageCounts));
    } catch {
      /* ignore storage errors */
    }
  }, [enquiries, stageCounts]);

  const syncFromWorker = async (manual = false) => {
    if (typeof fetch !== 'function') return;
    setIsLoading(true);
    setErrorBanner(null);
    try {
      const data = await fetchEnquiryDesk('default');
      if (!data.ok) {
        if (data.status !== 401) {
          setErrorBanner(`Cloud sync returned HTTP ${data.status}; showing local workspace state.`);
        }
        return;
      }
      if (Array.isArray(data.enquiries) && data.enquiries.length > 0) {
        const mapped: LocalEnquiryItem[] = data.enquiries.map((e) => {
          const rawAnswers = e.qualificationBrief?.recordedAnswers || {};
          const filteredAnswers: Record<string, { value?: string; messageId?: string }> = {};
          for (const [k, v] of Object.entries(rawAnswers)) {
            if (v && v.value && v.value !== 'unknown' && v.status !== 'unknown') {
              filteredAnswers[k] = { value: v.value, messageId: v.messageId };
            }
          }
          return {
            id: e.id,
            fullName: e.contactName,
            contactDetail: e.contactPhone || e.contactEmail || 'Inbound Enquiry',
            propertyAddress: e.propertyAddress || 'Address pending qualification',
            intentType: e.intentType,
            status: e.status === 'stalled' ? 'conversing' : e.status,
            automationPaused: e.automationPaused,
            slaDueAt: e.slaDueAt,
            answers: filteredAnswers,
            escalationReason: e.qualificationBrief?.escalationReason,
            proposedSlotLabel: 'Next Business Day 2:00 PM - Licensed Agent Appraisal',
          };
        });
        setEnquiries(mapped);
        setSelectedId(mapped[0]?.id || '');
      }
      if (data.funnel?.countsByStage) {
        setStageCounts((prev) => ({ ...prev, ...data.funnel?.countsByStage }));
      }
    } catch {
      if (manual) {
        setErrorBanner('Cloud D1 sync is currently offline; showing local workspace state.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void syncFromWorker();
  }, []);

  const activeEnquiry = enquiries.find((e) => e.id === selectedId) || enquiries[0] || null;

  const handleCreateEnquiry = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorBanner(null);
    if (!newFullName.trim() || !newMessage.trim()) {
      setErrorBanner('Enter both a prospect name and an inbound message to ingest an enquiry.');
      return;
    }

    const evalResult = evaluateInboundEnquiryTurn({
      intentType: newIntent,
      inboundText: newMessage.trim(),
      recordedAnswers: newAddress.trim() ? { property_address: newAddress.trim() } : {},
    });

    const created: LocalEnquiryItem = {
      id: `enq_${Date.now()}`,
      fullName: newFullName.trim(),
      contactDetail: 'Inbound Web Enquiry',
      propertyAddress: newAddress.trim() || 'Address pending qualification',
      intentType: newIntent,
      status: evalResult.action === 'instant_unsubscribe' ? 'closed' : 'conversing',
      automationPaused: evalResult.automationPaused,
      slaDueAt: Date.now() + (APPROVED_PLAYBOOKS[newIntent]?.defaultSlaMinutes || 15) * 60_000,
      answers: newAddress.trim()
        ? { property_address: { value: newAddress.trim(), messageId: `msg_${Date.now()}` } }
        : {},
      escalationReason:
        evalResult.action === 'escalate_to_agent' || evalResult.action === 'instant_unsubscribe'
          ? evalResult.reason
          : undefined,
      proposedSlotLabel: 'Next Business Day 2:00 PM - Licensed Agent Appraisal',
    };

    setEnquiries((prev) => [created, ...prev]);
    setSelectedId(created.id);
    setStageCounts((prev) => ({
      ...prev,
      enquiry_received: prev.enquiry_received + 1,
    }));
    setNewFullName('');
    setNewAddress('');
    setNewMessage('');
    setFeedbackBanner(
      evalResult.automationPaused
        ? `Statutory/Escalation Guard triggered: ${evalResult.reason}`
        : `Playbook reply prepared: "${evalResult.suggestedReply}"`,
    );

    if (typeof fetch === 'function') {
      const localTempId = created.id;
      void ingestEnquiryApi({
        projectId: 'default',
        fullName: created.fullName,
        propertyAddress: newAddress.trim() || undefined,
        intentType: created.intentType,
        initialMessage: newMessage.trim(),
      })
        .then((res) => {
          if (res.ok && res.enquiry?.id) {
            const serverId = res.enquiry.id;
            const rawStatus = res.enquiry.status;
            const serverStatus: LocalEnquiryItem['status'] | undefined =
              rawStatus === 'stalled' ? 'conversing' : (rawStatus as LocalEnquiryItem['status'] | undefined);
            setEnquiries((prev) =>
              prev.map((item) =>
                item.id === localTempId
                  ? {
                      ...item,
                      id: serverId,
                      status: serverStatus || item.status,
                      automationPaused:
                        typeof res.enquiry?.automationPaused === 'boolean'
                          ? res.enquiry.automationPaused
                          : item.automationPaused,
                    }
                  : item,
              ),
            );
            setSelectedId((prev) => (prev === localTempId ? serverId : prev));
          }
        })
        .catch(() => null);
    }
  };

  const handleAppendTurn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeEnquiry || !followUpText.trim()) return;
    const text = followUpText.trim();
    setFollowUpText('');
    const existingStrings: Record<string, string> = {};
    for (const [k, v] of Object.entries(activeEnquiry.answers)) {
      if (v?.value) existingStrings[k] = v.value;
    }
    const evalResult = evaluateInboundEnquiryTurn({
      intentType: activeEnquiry.intentType,
      inboundText: text,
      recordedAnswers: existingStrings,
    });
    const nextField =
      evalResult.action === 'continue_playbook' ? evalResult.nextQuestion?.fieldKey : undefined;
    const nextAnswers = { ...activeEnquiry.answers };
    if (nextField && !nextAnswers[nextField]?.value) {
      nextAnswers[nextField] = { value: text, messageId: `msg_${Date.now()}` };
    }
    setEnquiries((prev) =>
      prev.map((item) =>
        item.id === activeEnquiry.id
          ? {
              ...item,
              answers: nextAnswers,
              automationPaused: evalResult.automationPaused || item.automationPaused,
              status:
                evalResult.action === 'instant_unsubscribe'
                  ? 'closed'
                  : evalResult.action === 'continue_playbook' && !evalResult.nextQuestion
                    ? 'qualified'
                    : item.status,
            }
          : item,
      ),
    );
    setStageCounts((prev) => ({
      ...prev,
      two_way_conversation: prev.two_way_conversation + 1,
    }));
    setFeedbackBanner(
      evalResult.suggestedReply
        ? `Turn evaluated: "${evalResult.suggestedReply}"`
        : 'Follow-up turn recorded in Opportunity Brief.',
    );
    if (typeof fetch === 'function') {
      void appendEnquiryTurnApi(activeEnquiry.id, {
        sender: 'prospect',
        text,
        extractedAnswers: nextField ? { [nextField]: text } : undefined,
      })
        .then((res) => {
          const reply =
            typeof res.evaluation?.suggestedReply === 'string'
              ? res.evaluation.suggestedReply
              : null;
          if (res.ok && reply) {
            setFeedbackBanner(`Playbook reply: "${reply}"`);
          }
        })
        .catch(() => null);
    }
  };

  const handleToggleTakeover = (enquiryId: string) => {
    const target = enquiries.find((item) => item.id === enquiryId);
    const nextPaused = target ? !target.automationPaused : true;
    setEnquiries((prev) =>
      prev.map((item) =>
        item.id === enquiryId ? { ...item, automationPaused: nextPaused } : item,
      ),
    );
    if (typeof fetch === 'function') {
      void setEnquiryTakeoverApi(enquiryId, { paused: nextPaused }).catch(() => null);
    }
  };

  const handleApproveBooking = (enquiryId: string) => {
    const target = enquiries.find((item) => item.id === enquiryId);
    setEnquiries((prev) =>
      prev.map((item) =>
        item.id === enquiryId
          ? {
              ...item,
              status: 'booked',
              bookingApprovedBy: 'Licensed Principal Agent',
            }
          : item,
      ),
    );
    setStageCounts((prev) => ({
      ...prev,
      agent_approved_booking: prev.agent_approved_booking + 1,
    }));
    setFeedbackBanner('Appraisal booking signed off and recorded in the 6-stage Outcomes Ledger.');
    if (typeof fetch === 'function') {
      const now = Date.now();
      const approveFlow = async () => {
        let apptId = target?.appointmentId;
        if (!apptId) {
          const propRes = await proposeBookingSlotsApi(enquiryId, {
            proposedSlots: [
              {
                slotId: 'slot_1',
                startAt: now + 24 * 3600_000,
                endAt: now + 24 * 3600_000 + 30 * 60_000,
                label: target?.proposedSlotLabel || 'Next Business Day 2:00 PM',
              },
            ],
          });
          if (propRes.ok && propRes.appointment?.id) {
            apptId = propRes.appointment.id;
            setEnquiries((prev) =>
              prev.map((item) => (item.id === enquiryId ? { ...item, appointmentId: apptId } : item)),
            );
          }
        }
        if (apptId) {
          await decideBookingAppointmentApi(apptId, {
            decision: 'approve',
            selectedSlotId: 'slot_1',
          });
        } else {
          await recordOutcomeStageApi({
            projectId: 'default',
            enquiryId,
            stage: 'agent_approved_booking',
            evidenceType: 'agent_signoff_receipt',
            evidenceRef: `signoff_${enquiryId}_${now}`,
          });
        }
      };
      void approveFlow().catch(() => null);
    }
  };

  const handleDeclineBooking = (enquiryId: string) => {
    const target = enquiries.find((item) => item.id === enquiryId);
    setEnquiries((prev) =>
      prev.map((item) =>
        item.id === enquiryId
          ? { ...item, status: 'qualified', bookingApprovedBy: undefined }
          : item,
      ),
    );
    setFeedbackBanner('Proposed booking slot declined; enquiry returned to Qualified queue.');
    if (typeof fetch === 'function' && target?.appointmentId) {
      void decideBookingAppointmentApi(target.appointmentId, { decision: 'decline' }).catch(
        () => null,
      );
    }
  };

  const handleSendRecoveryStep = async (enquiryId: string) => {
    setErrorBanner(null);
    setFeedbackBanner('Consent-guarded recovery check dispatched.');
    if (typeof fetch === 'function') {
      const res = await sendRecoveryStepApi({
        projectId: 'default',
        enquiryId,
        playbookId: 'missed_enquiry_recovery',
        channel: 'sms',
        stepIndex: 0,
        messageBody: 'Checking if you would still like our licensed agent to arrange your appraisal.',
        agencyLegalName: 'Luminara Partner Agency',
        agencyContactDetails: 'Subscribed Enquiry Desk',
      }).catch(() => null);
      if (res && !res.ok && res.error) {
        setErrorBanner(`Recovery compliance gate: ${res.error}`);
      } else if (res && res.ok) {
        setFeedbackBanner(
          `Compliant recovery SMS queued (${res.runId || 'verified'}): "${res.formattedMessage || ''}"`,
        );
      }
    }
  };

  const handleSyncTwenty = async (enquiryId: string) => {
    if (!twentyBaseUrl.trim() || !twentyApiKey.trim()) {
      setErrorBanner('Provide both a Twenty CRM HTTPS Base URL and API Key to sync.');
      return;
    }
    setErrorBanner(null);
    const res = await syncEnquiryToTwentyApi({
      enquiryId,
      baseUrl: twentyBaseUrl.trim(),
      apiKey: twentyApiKey.trim(),
    }).catch(() => null);
    if (res?.ok) {
      setFeedbackBanner(
        `Synced to Twenty CRM (Person: ${res.personExternalId || 'ok'}, Opportunity: ${res.opportunityExternalId || 'ok'}).`,
      );
    } else {
      setErrorBanner(res?.error || 'Twenty CRM GraphQL sync could not be completed.');
    }
  };

  const handleRecordStaffOutcome = (stage: 'attended_appraisal' | 'signed_listing') => {
    setStageCounts((prev) => ({
      ...prev,
      [stage]: prev[stage] + 1,
    }));
    setFeedbackBanner(
      `Recorded ${STAGE_LABELS[stage]} with staff confirmation receipt in Outcomes Ledger.`,
    );
    if (typeof fetch === 'function' && activeEnquiry) {
      void recordOutcomeStageApi({
        projectId: 'default',
        enquiryId: activeEnquiry.id,
        stage,
        evidenceType: 'staff_confirmation',
        evidenceRef: `staff_${activeEnquiry.id}_${Date.now()}`,
      }).catch(() => null);
    }
  };

  const activeBrief = activeEnquiry
    ? buildOpportunityBrief({
        intentType: activeEnquiry.intentType,
        answers: activeEnquiry.answers,
        escalationReason: activeEnquiry.escalationReason,
      })
    : null;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6 text-white">
      {/* Spine Header */}
      <div className="rounded-2xl border border-gold/30 bg-black/80 p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-gold-light">
              4-Module Conversion Spine // Visibility &rarr; Enquiry Desk &rarr; Recovery &rarr; Outcomes
            </span>
            <h2 className="text-lg font-bold text-white mt-0.5">
              Real Estate &amp; SME Enquiry Desk &amp; Agent-Approved Booking Board
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-[11px] font-mono text-gray-300">
              Revenue Attribution: [not_measured] (Evidence-Only Ledger)
            </span>
            <button
              type="button"
              onClick={() => void syncFromWorker(true)}
              disabled={isLoading}
              className="px-2.5 py-1 rounded-lg border border-gold/30 bg-gold/10 text-[11px] font-mono text-gold-light hover:bg-gold/20 disabled:opacity-50"
            >
              {isLoading ? 'Syncing...' : 'Sync Cloud D1'}
            </button>
          </div>
        </div>

        {/* 6-Stage Outcomes Funnel Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 pt-2">
          {OUTCOME_STAGES.map((stage) => (
            <div
              key={stage}
              className="p-3 rounded-xl bg-white/[0.03] border border-white/10 flex flex-col justify-between"
            >
              <span className="text-[10px] font-mono text-gray-400 uppercase">
                {STAGE_LABELS[stage]}
              </span>
              <span className="text-xl font-bold text-gold-light font-mono tabular-nums mt-1">
                {stageCounts[stage]}
              </span>
            </div>
          ))}
        </div>
      </div>

      {errorBanner && (
        <div
          role="alert"
          className="p-3 rounded-xl border border-danger-500/40 bg-danger-500/10 text-xs text-danger-200 flex items-center justify-between"
        >
          <span>{errorBanner}</span>
          <button
            type="button"
            onClick={() => setErrorBanner(null)}
            className="text-[10px] font-mono underline ml-3"
          >
            Dismiss
          </button>
        </div>
      )}

      {feedbackBanner && (
        <div className="p-3 rounded-xl border border-gold/40 bg-gold/10 text-xs text-gold-light flex items-center justify-between">
          <span>{feedbackBanner}</span>
          <button
            type="button"
            onClick={() => setFeedbackBanner(null)}
            className="text-[10px] font-mono underline ml-3"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main 12-Column Asymmetric Bento Grid (5 + 7) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column (5 cols): Inbound Capture & Enquiry Queue */}
        <div className="lg:col-span-5 space-y-4">
          <form
            onSubmit={(e) => void handleCreateEnquiry(e)}
            className="p-4 rounded-xl border border-white/10 bg-black/70 space-y-3"
          >
            <div className="text-xs font-bold uppercase tracking-wider text-gold-light">
              Test Inbound Enquiry &amp; Statutory Guard
            </div>
            <div>
              <label
                htmlFor="enquiry-prospect-name"
                className="block text-[10px] font-bold uppercase text-gray-400 mb-1"
              >
                Prospect Name
              </label>
              <input
                id="enquiry-prospect-name"
                type="text"
                value={newFullName}
                onChange={(e) => setNewFullName(e.target.value)}
                placeholder="e.g. Michael Chen"
                className="w-full bg-black/80 border border-white/15 rounded-lg px-3 py-1.5 text-xs text-white"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label
                  htmlFor="enquiry-playbook-type"
                  className="block text-[10px] font-bold uppercase text-gray-400 mb-1"
                >
                  Playbook Type
                </label>
                <select
                  id="enquiry-playbook-type"
                  value={newIntent}
                  onChange={(e) => setNewIntent(e.target.value as EnquiryIntentType)}
                  className="w-full bg-black/80 border border-white/15 rounded-lg px-2.5 py-1.5 text-xs text-white"
                >
                  {Object.values(APPROVED_PLAYBOOKS).map((pb) => (
                    <option key={pb.id} value={pb.id}>
                      {pb.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor="enquiry-property-address"
                  className="block text-[10px] font-bold uppercase text-gray-400 mb-1"
                >
                  Property / Suburb
                </label>
                <input
                  id="enquiry-property-address"
                  type="text"
                  value={newAddress}
                  onChange={(e) => setNewAddress(e.target.value)}
                  placeholder="18 Bay St, Double Bay"
                  className="w-full bg-black/80 border border-white/15 rounded-lg px-3 py-1.5 text-xs text-white"
                />
              </div>
            </div>
            <div>
              <label
                htmlFor="enquiry-inbound-message"
                className="block text-[10px] font-bold uppercase text-gray-400 mb-1"
              >
                Inbound Prospect Message
              </label>
              <input
                id="enquiry-inbound-message"
                type="text"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder="e.g. Looking for a spring appraisal (or try: how much is my house worth?)"
                className="w-full bg-black/80 border border-white/15 rounded-lg px-3 py-1.5 text-xs text-white"
              />
            </div>
            <button
              type="submit"
              className="w-full py-2 rounded-lg bg-gold text-black font-bold text-xs uppercase tracking-wider hover:bg-gold-light transition-colors"
            >
              Ingest Enquiry into Playbook
            </button>
          </form>

          <div className="flex items-center justify-between px-1">
            <span className="text-[10px] font-mono uppercase text-gray-400">
              Active Queue ({enquiries.length})
            </span>
            <button
              type="button"
              onClick={() => {
                if (enquiries.length > 0) {
                  setEnquiries([]);
                  setSelectedId('');
                } else {
                  const seeded = createInitialEnquiries();
                  setEnquiries(seeded);
                  setSelectedId(seeded[0]?.id || '');
                }
              }}
              className="text-[10px] font-mono text-gold-light hover:underline"
            >
              {enquiries.length > 0 ? 'Clear Queue' : 'Load Sample Enquiry'}
            </button>
          </div>

          {isLoading ? (
            <div className="space-y-2" aria-busy="true">
              <div className="h-16 rounded-xl bg-white/5 border border-white/10 animate-pulse" />
              <div className="h-16 rounded-xl bg-white/5 border border-white/10 animate-pulse" />
            </div>
          ) : enquiries.length === 0 ? (
            <div className="p-4 rounded-xl border border-dashed border-white/15 bg-black/40 text-center text-[11px] text-gray-400">
              Queue is empty. Ingest a test enquiry above or load the sample appraisal.
            </div>
          ) : (
            <div className="space-y-2">
              {enquiries.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={`w-full text-left p-3.5 rounded-xl border transition-all ${
                    activeEnquiry?.id === item.id
                      ? 'border-gold bg-gold/10'
                      : 'border-white/10 bg-black/60 hover:border-white/25'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-white">{item.fullName}</span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-mono ${
                        item.automationPaused
                          ? 'bg-danger-500/20 text-danger-300'
                          : 'bg-success-500/20 text-success-300'
                      }`}
                    >
                      {item.automationPaused ? 'HUMAN TAKEOVER' : item.status.toUpperCase()}
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1 truncate">{item.propertyAddress}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right Column (7 cols): Evidence-Bound Opportunity Brief & Agent Booking Sign-Off */}
        <div className="lg:col-span-7 space-y-4">
          {activeEnquiry && activeBrief ? (
            <div className="p-5 rounded-2xl border border-white/15 bg-black/80 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 pb-3">
                <div>
                  <span className="text-[10px] font-mono uppercase text-gold-light">
                    {activeBrief.playbookName}
                  </span>
                  <h3 className="text-base font-bold text-white mt-0.5">
                    {activeEnquiry.fullName} ({activeEnquiry.propertyAddress})
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => handleToggleTakeover(activeEnquiry.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                    activeEnquiry.automationPaused
                      ? 'border-success-500/40 bg-success-500/10 text-success-300'
                      : 'border-warning-500/40 bg-warning-500/10 text-warning-200'
                  }`}
                >
                  {activeEnquiry.automationPaused
                    ? 'Resume Approved Playbook'
                    : 'Take Over Conversation (Pause AI)'}
                </button>
              </div>

              <div className="p-3 rounded-xl bg-white/[0.03] border border-white/10 space-y-2">
                <div className="text-xs font-bold text-gold-light">
                  Evidence-Bound Opportunity Brief (ClaimLedger)
                </div>
                <p className="text-xs text-gray-300">{activeBrief.summaryVerdict}</p>
                <ul className="space-y-1.5 pt-1">
                  {activeBrief.claims.map((claim) => (
                    <li
                      key={claim.id}
                      className="text-[11px] font-mono flex items-center justify-between gap-2 p-2 rounded bg-black/50 border border-white/5"
                    >
                      <span className="text-gray-200">{claim.text}</span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] ${
                          claim.status === 'measured'
                            ? 'bg-success-500/20 text-success-300'
                            : 'bg-white/10 text-gray-400'
                        }`}
                      >
                        [{claim.status}]
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Agent-Approved Booking Gate */}
              <div className="p-4 rounded-xl border border-gold/30 bg-gold/5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-gold-light uppercase tracking-wider">
                    Agent-Approved Appraisal Booking Gate
                  </span>
                  <span className="text-[10px] font-mono text-gray-400">
                    {activeEnquiry.bookingApprovedBy
                      ? `Signed off by ${activeEnquiry.bookingApprovedBy}`
                      : 'Awaiting Agent Sign-Off'}
                  </span>
                </div>
                <p className="text-xs text-gray-300">
                  Proposed Slot: <strong className="text-white">{activeEnquiry.proposedSlotLabel}</strong>
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={activeEnquiry.status === 'booked'}
                    onClick={() => handleApproveBooking(activeEnquiry.id)}
                    className="px-3.5 py-1.5 rounded-lg bg-gold text-black font-bold text-xs disabled:opacity-40"
                  >
                    {activeEnquiry.status === 'booked'
                      ? 'Booking Approved'
                      : 'Approve Appraisal Slot'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeclineBooking(activeEnquiry.id)}
                    className="px-3 py-1.5 rounded-lg border border-white/15 bg-black/60 text-xs text-gray-300 hover:text-white"
                  >
                    Decline Slot
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRecordStaffOutcome('attended_appraisal')}
                    className="px-3 py-1.5 rounded-lg border border-white/15 bg-black/60 text-xs text-gray-200 hover:text-white"
                  >
                    Confirm Attended Appraisal
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRecordStaffOutcome('signed_listing')}
                    className="px-3 py-1.5 rounded-lg border border-gold/40 bg-black/60 text-xs text-gold-light hover:bg-gold/10"
                  >
                    Record Signed Listing Receipt
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSendRecoveryStep(activeEnquiry.id)}
                    className="px-3 py-1.5 rounded-lg border border-white/15 bg-black/60 text-xs text-gray-200 hover:text-white"
                  >
                    Send Consent-Guarded Recovery Step
                  </button>
                </div>
              </div>

              {/* Follow-Up Turn & Optional Twenty CRM Sync */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <form
                  onSubmit={(e) => void handleAppendTurn(e)}
                  className="p-3 rounded-xl border border-white/10 bg-black/60 space-y-2"
                >
                  <label
                    htmlFor="enquiry-followup-turn"
                    className="block text-[10px] font-bold uppercase text-gray-400"
                  >
                    Append Prospect Reply Turn
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="enquiry-followup-turn"
                      type="text"
                      value={followUpText}
                      onChange={(e) => setFollowUpText(e.target.value)}
                      placeholder="e.g. 4 bed house, ready in 30 days"
                      className="flex-1 bg-black/80 border border-white/15 rounded-lg px-2.5 py-1 text-xs text-white"
                    />
                    <button
                      type="submit"
                      className="px-2.5 py-1 rounded-lg bg-gold/20 border border-gold/40 text-gold-light text-[11px] font-mono"
                    >
                      Send Turn
                    </button>
                  </div>
                </form>

                <div className="p-3 rounded-xl border border-white/10 bg-black/60 space-y-2">
                  <span className="block text-[10px] font-bold uppercase text-gray-400">
                    Optional Twenty CRM GraphQL Sync
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    <input
                      type="url"
                      aria-label="Twenty CRM Base URL"
                      value={twentyBaseUrl}
                      onChange={(e) => setTwentyBaseUrl(e.target.value)}
                      placeholder="https://crm.agency.com.au"
                      className="flex-1 min-w-[120px] bg-black/80 border border-white/15 rounded-lg px-2 py-1 text-[11px] text-white"
                    />
                    <input
                      type="password"
                      aria-label="Twenty CRM API Key"
                      value={twentyApiKey}
                      onChange={(e) => setTwentyApiKey(e.target.value)}
                      placeholder="API Token"
                      className="w-24 bg-black/80 border border-white/15 rounded-lg px-2 py-1 text-[11px] text-white"
                    />
                    <button
                      type="button"
                      onClick={() => void handleSyncTwenty(activeEnquiry.id)}
                      className="px-2.5 py-1 rounded-lg bg-white/10 border border-white/20 text-white text-[11px] font-mono hover:bg-white/15"
                    >
                      Sync CRM
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-8 rounded-2xl border border-white/10 bg-black/60 text-center space-y-3">
              <p className="text-xs text-gray-400">
                No enquiries in queue. Use the form on the left to ingest a real estate or SME enquiry, or load the sample appraisal flow.
              </p>
              <button
                type="button"
                onClick={() => {
                  const seeded = createInitialEnquiries();
                  setEnquiries(seeded);
                  setSelectedId(seeded[0]?.id || '');
                }}
                className="px-3.5 py-1.5 rounded-lg border border-gold/40 bg-gold/10 text-xs font-mono text-gold-light hover:bg-gold/20"
              >
                Load Sample Seller Appraisal
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
