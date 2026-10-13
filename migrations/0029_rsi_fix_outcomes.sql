-- Citation rates on fix observations, so action memory can rank what was measured.

ALTER TABLE rsi_fix_observations ADD COLUMN before_citation_rate REAL;
ALTER TABLE rsi_fix_observations ADD COLUMN after_citation_rate REAL;
ALTER TABLE rsi_fix_observations ADD COLUMN measurement_status TEXT NOT NULL DEFAULT 'not_measured';
ALTER TABLE rsi_fix_observations ADD COLUMN effect TEXT NOT NULL DEFAULT 'not_measured';
