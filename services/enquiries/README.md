# Enquiry Qualification & Idempotency (`services/enquiries/`)

Shared deterministic services for Luminara Suite's Enquiry Desk & Conversion Spine.

## Files

- `playbookQualificationService.ts`:
  - Defines approved real-estate and SME playbooks (`seller_appraisal`, `buyer_enquiry`, `landlord_management`, `general_sme`).
  - Evaluates inbound turns (`evaluateInboundEnquiryTurn`) in strict priority order:
    1. Opt-out keywords (`STOP`, `UNSUBSCRIBE`, `OPT OUT`, `REMOVE ME`) -> `instant_unsubscribe` (`automationPaused = true`).
    2. Australian statutory/fiduciary escalation triggers (`Section 32`, cooling-off waivers, strata/body corporate disputes, price guarantees, tenancy bond disputes) -> `escalate_to_agent` (`automationPaused = true`).
    3. Approved playbook slot extraction and next-question routing -> `continue_playbook` (with `nextQuestionKey` when required slots remain, or ready for agent-approved booking sign-off when all required fields are captured).
  - Builds `OpportunityBrief` (`buildOpportunityBrief`) backed by an Evidence-Bound `ClaimLedger` (`services/evidenceBound/claimLedger.ts`) where every answered slot is recorded as `status: 'measured'` with its transcript `messageId` and every missing slot is recorded as `status: 'unknown'`.
  - Computes deterministic `computeExternalEffectKey` (`SHA-256` over canonical JSON via `services/trust/receiptCrypto.ts`) used by `worker/externalEffectsService.ts` to prevent duplicate external side effects across retries.
- `enquiryApiClient.ts`:
  - Typed frontend client for `/api/enquiries`, `/api/outcomes`, `/api/recovery`, and `/api/cms-mcp` backed by `workerFetchWithAuthRetry`.

## Invariants

- Never invent qualification answers or revenue estimates; missing qualification slots stay `status: 'unknown'` and funnel revenue attribution stays `'not_measured'`.
- Never allow AI responses to improvise answers on statutory, contract, or price-guarantee questions.
