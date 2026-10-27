-- 0042_conversion_enquiry_spine.sql
-- 4-Module Conversion Spine: Visibility -> Enquiry Desk -> Recovery -> Outcomes
-- Includes Rakazo-style external_effects idempotency ledger, distinct Contact / Property / Enquiry /
-- AppraisalAppointment / RecoveryRun records, and the 6-stage evidence-backed outcome_stage_events ledger.

CREATE TABLE IF NOT EXISTS external_effects (
  effect_key TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  target_system TEXT NOT NULL,
  action_kind TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  result_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_external_effects_account_project
  ON external_effects (account_id, project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS crm_contacts (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  phone_e164 TEXT,
  preferred_channel TEXT NOT NULL DEFAULT 'email',
  consent_status TEXT NOT NULL DEFAULT 'inferred_enquiry',
  consent_source TEXT NOT NULL DEFAULT 'inbound_enquiry',
  consent_recorded_at INTEGER NOT NULL,
  dncr_checked_at INTEGER,
  dncr_status TEXT NOT NULL DEFAULT 'unknown',
  state_timezone TEXT NOT NULL DEFAULT 'Australia/Sydney',
  external_crm_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_crm_contacts_project
  ON crm_contacts (account_id, project_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_crm_contacts_email
  ON crm_contacts (account_id, email);

CREATE TABLE IF NOT EXISTS crm_properties (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  address_full TEXT NOT NULL,
  suburb TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  postcode TEXT NOT NULL DEFAULT '',
  property_type TEXT NOT NULL DEFAULT 'residential',
  bedrooms INTEGER,
  bathrooms INTEGER,
  estimated_range_note TEXT,
  external_property_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_crm_properties_project_suburb
  ON crm_properties (account_id, project_id, suburb, postcode);

CREATE TABLE IF NOT EXISTS contact_property_links (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  property_id TEXT NOT NULL,
  relationship_role TEXT NOT NULL DEFAULT 'owner',
  created_at INTEGER NOT NULL,
  UNIQUE(account_id, contact_id, property_id, relationship_role)
);

CREATE TABLE IF NOT EXISTS enquiries (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  property_id TEXT,
  source_channel TEXT NOT NULL DEFAULT 'web_widget',
  intent_type TEXT NOT NULL DEFAULT 'seller_appraisal',
  status TEXT NOT NULL DEFAULT 'new',
  assigned_agent_id TEXT,
  sla_due_at INTEGER NOT NULL,
  automation_paused INTEGER NOT NULL DEFAULT 0,
  qualification_brief_json TEXT NOT NULL DEFAULT '{}',
  conversation_json TEXT NOT NULL DEFAULT '[]',
  attribution_audit_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_enquiries_project_status
  ON enquiries (account_id, project_id, status, sla_due_at ASC);

CREATE TABLE IF NOT EXISTS appraisal_appointments (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  enquiry_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  property_id TEXT,
  assigned_agent_id TEXT NOT NULL,
  proposed_slots_json TEXT NOT NULL DEFAULT '[]',
  confirmed_start_at INTEGER,
  confirmed_end_at INTEGER,
  approval_status TEXT NOT NULL DEFAULT 'pending_agent_signoff',
  approved_by_user_id TEXT,
  approved_at INTEGER,
  calendar_external_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_appraisal_appointments_project
  ON appraisal_appointments (account_id, project_id, approval_status, created_at DESC);

CREATE TABLE IF NOT EXISTS recovery_runs (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  enquiry_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  playbook_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  step_index INTEGER NOT NULL DEFAULT 0,
  last_effect_key TEXT,
  next_wake_at INTEGER,
  stop_reason TEXT,
  run_history_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_recovery_runs_project_status
  ON recovery_runs (account_id, project_id, status, next_wake_at ASC);

CREATE TABLE IF NOT EXISTS outcome_stage_events (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  enquiry_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  evidence_type TEXT NOT NULL,
  evidence_ref TEXT NOT NULL,
  notes TEXT,
  recorded_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(account_id, enquiry_id, stage)
);

CREATE INDEX IF NOT EXISTS idx_outcome_stage_events_project
  ON outcome_stage_events (account_id, project_id, stage, created_at DESC);
