/** Which account-keyed tables a privacy export and an account deletion cover, and why any are left out. */
export const OWN_USER_IDS = `user_id = ?1 OR user_id IN (SELECT id FROM users WHERE account_id = ?1)`;

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

/** Export rows by table. Named columns keep token hashes and secrets out. `where` binds the account id as ?1. */
export const TABLE_EXPORTS: ReadonlyArray<{ key: string; table: string; columns?: string; where?: string }> = [
  { key: 'auditFindings', table: 'audit_findings' },
  { key: 'preparedAssets', table: 'prepared_assets' },
  { key: 'memoryHistory', table: 'memory_history' },
  { key: 'memoryChatExtractions', table: 'memory_chat_extractions' },
  { key: 'aiAnswerCaptures', table: 'ai_answer_captures' },
  { key: 'reputationAlerts', table: 'reputation_alerts' },
  { key: 'thinStackInventory', table: 'thin_stack_inventory' },
  { key: 'productAnalyticsEvents', table: 'product_analytics_events' },
  { key: 'winShares', table: 'win_shares', where: 'owner_id = ?1' },
  {
    key: 'sharedReports',
    table: 'shared_reports',
    columns: 'id, client_id, report_json, branding_json, expires_at, revoked_at, created_at',
    where: 'owner_account_id = ?1',
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
  cost_events: 'Spend ledger with no content, needed to reconcile provider invoices.',
  firestore_erase_ledger: 'Tombstone that stops an old export recreating the account.',
  invoice_reconcile_runs: 'Financial reconciliation record.',
  launchpad_campaigns: 'Only campaigns on a public chain or with vouchers issued stay, unlisted, without tax id or compliance detail.',
  license_redemptions: 'Stops a one-time license key being redeemed twice.',
  license_trial_claims: 'Stops a one-time trial being claimed twice.',
  privacy_jobs: 'Record that the erasure request was carried out.',
  stars_credited_charges: 'Payment record, needed for disputes.',
  stripe_credited_sessions: 'Payment record, needed for disputes.',
  ton_credited_tx: 'Payment record. The transaction is on a public chain.',
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
  ...RSI_TABLES,
];
