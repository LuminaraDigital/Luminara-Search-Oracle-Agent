-- Explicit workspace invite acceptance.
-- Existing active rows stay active. New columns are nullable, so current access is unchanged.
-- Rollback: the app can ignore the columns. Dropping them is optional and not required to roll back.

ALTER TABLE client_workspace_members ADD COLUMN id TEXT;
ALTER TABLE client_workspace_members ADD COLUMN expires_at INTEGER;
ALTER TABLE client_workspace_members ADD COLUMN declined_at INTEGER;

UPDATE client_workspace_members
SET id = 'inv_' || lower(hex(randomblob(12)))
WHERE id IS NULL OR trim(id) = '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_client_workspace_members_id
  ON client_workspace_members(id);
