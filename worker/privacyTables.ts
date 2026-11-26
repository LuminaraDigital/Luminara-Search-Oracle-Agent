/** Which account-keyed tables a privacy export and an account deletion cover, and why any are left out. */
/** Login ids of one account. Every `?` in a privacy query binds the same account id (see accountBinds). */
export const OWN_USER_IDS = `user_id = ? OR user_id IN (SELECT id FROM users WHERE account_id = ?)`;

/** Plain `?` placeholders only (numbered ones are not portable), so bind the account id once per `?`. */
export function accountBinds(sql: string, accountId: string): string[] {
  return Array.from({ length: (sql.match(/\?/g) || []).length }, () => accountId);
}

/** Erased accounts' rows in pseudonymized ledgers carry this value instead of the account id. */
export const ERASED_ACCOUNT_PLACEHOLDER = 'erased';

const RSI_TABLES = [
  'rsi_eval_cases',
  'rsi_fix_observations',
  'rsi_memory_documents',
  'rsi_post_metrics',
  'rsi_post_reflections',
  'rsi_posts',
  'rsi_prompt_changes',
  'rsi_replay_nodes',
  'rsi_reward_profiles',
  'rsi_reward_revisions',
  'rsi_skill_proposals',
  'rsi_skill_revisions',
  'rsi_skills',
  'rsi_strategy_slots',
];

/** Export rows by table. Named columns keep token hashes and secrets out. Every `?` in `where` binds the account id. */
export const TABLE_EXPORTS: ReadonlyArray<{ key: string; table: string; columns?: string; where?: string }> = [
  { key: 'auditFindings', table: 'audit_findings' },
  { key: 'preparedAssets', table: 'prepared_assets' },
  { key: 'memoryHistory', table: 'memory_history' },
  { key: 'memoryChatExtractions', table: 'memory_chat_extractions' },
  { key: 'aiAnswerCaptures', table: 'ai_answer_captures' },
  { key: 'reputationAlerts', table: 'reputation_alerts' },
  { key: 'thinStackInventory', table: 'thin_stack_inventory' },
  { key: 'productAnalyticsEvents', table: 'product_analytics_events' },
  { key: 'winShares', table: 'win_shares', where: 'owner_id = ?' },
  {
    key: 'sharedReports',
    table: 'shared_reports',
    columns: 'id, client_id, report_json, branding_json, expires_at, revoked_at, created_at',
    where: 'owner_account_id = ?',
  },
  { key: 'businessMemories', table: 'business_memories' },
  { key: 'dreamEvents', table: 'dream_events' },
  { key: 'dreamProposals', table: 'dream_proposals' },
  { key: 'dreamRuns', table: 'dream_runs' },
  { key: 'visibilitySnapshots', table: 'visibility_snapshots' },
  { key: 'budgetPolicies', table: 'budget_policies' },
  { key: 'budgetIncidents', table: 'budget_incidents' },
  { key: 'costEvents', table: 'cost_events' },
  { key: 'runProvenance', table: 'run_provenance' },
  { key: 'proofSchedules', table: 'proof_schedules' },
  { key: 'apiKeys', table: 'api_keys', columns: 'id, name, key_prefix, last_used_at, created_at, revoked_at' },
  { key: 'searchConsoleConnection', table: 'gsc_oauth_tokens', columns: 'scopes, updated_at' },
  { key: 'mcpActionRequests', table: 'mcp_action_requests', where: OWN_USER_IDS },
  { key: 'organizationMemberships', table: 'organization_memberships', columns: 'org_id, role, status, joined_at', where: OWN_USER_IDS },
  { key: 'launchpadCampaigns', table: 'launchpad_campaigns' },
  {
    key: 'stripeCredits',
    table: 'stripe_credited_sessions',
    columns: 'plan_id, amount_total, currency, credited_at, granted_days, granted_until, reversed_at, reversal_reason',
  },
  { key: 'tonCredits', table: 'ton_credited_tx' },
  { key: 'licenseRedemptions', table: 'license_redemptions', columns: 'redeemed_at' },
  { key: 'licenseTrialClaims', table: 'license_trial_claims', columns: 'claimed_at' },
  { key: 'weeklyReportSends', table: 'weekly_report_sends' },
  { key: 'weeklyVisibilityReads', table: 'weekly_visibility_reads' },
  {
    key: 'connectedAssistants',
    table: 'mcp_oauth_refresh_family',
    columns: 'client_id, client_name, granted_scope, revoked, updated_at',
  },
  {
    key: 'clientWorkspaceMemberships',
    table: 'client_workspace_members',
    columns: 'workspace_id, role, client_id, status, invited_at, accepted_at',
    where: OWN_USER_IDS,
  },
  { key: 'agentTraceSpans', table: 'agent_trace_spans' },
  {
    key: 'externalMcpServers',
    table: 'mcp_external_servers',
    columns: 'id, project_id, name, endpoint_url, allowed_tools_json, enabled, created_at, updated_at',
  },
  ...RSI_TABLES.map((table) => ({ key: table, table })),
];

/** Every table this list adds to the export, for the coverage test. */
export const EXPORTED_TABLES = TABLE_EXPORTS.map((entry) => entry.table);

/** Account-keyed tables the export skips on purpose. */
export const EXPORT_EXEMPT: Record<string, string> = {
  firestore_erase_ledger: 'Internal erase tombstone.',
  idea_scout_daily: 'Daily usage counter with no content.',
  invoice_reconcile_runs: 'Internal comparison with provider invoices.',
  privacy_jobs: 'Holds token hashes for this export flow.',
  scout_receipts: 'Single-use token hash.',
  stars_credited_charges: 'Same charges as stars_charges, which is exported.',
};

/** Account-keyed rows that stay after deletion, and why. The privacy policy must allow each one. */
export const ERASE_RETAINED: Record<string, string> = {
  firestore_erase_ledger: 'Tombstone that stops an old export recreating the account.',
  launchpad_campaigns: 'Only campaigns on a public chain stay, unlisted, with personal detail removed and open vouchers cancelled.',
  privacy_jobs: 'Record that the erasure request was carried out.',
  stars_credited_charges: 'Payment record, needed for disputes.',
  stripe_credited_sessions: 'Payment record, needed for disputes.',
  ton_credited_tx: 'Payment record. The transaction is on a public chain.',
};

/**
 * Spend ledgers with no content. Rows stay so provider invoice totals still reconcile, but the account id
 * is replaced with ERASED_ACCOUNT_PLACEHOLDER and project and run links are cleared, so nothing points back
 * to the person. Owner decision pending: delete these outright instead.
 */
export const ERASE_PSEUDONYMIZED: Record<string, string> = {
  cost_events: 'UPDATE cost_events SET account_id = ?, project_id = NULL, run_id = NULL WHERE account_id = ?',
  invoice_reconcile_runs: "UPDATE invoice_reconcile_runs SET account_id = ?, notes = '' WHERE account_id = ?",
};

/** Deleted by account_id, in this order. Incidents go before the budget policies they point at. */
export const ERASED_TABLES = [
  'api_keys',
  'gsc_oauth_tokens',
  'business_memories',
  'dream_proposals',
  'dream_events',
  'dream_runs',
  'visibility_snapshots',
  'budget_incidents',
  'budget_policies',
  'proof_schedules',
  'run_provenance',
  'weekly_report_sends',
  'weekly_visibility_reads',
  // One-time key caps live in license_key_claims (no account id), so these rows stop nothing once the
  // account is gone: a new sign-up is a new account id.
  'license_redemptions',
  'license_trial_claims',
  ...RSI_TABLES,
];
