-- Remove plain-text BYOK key maps from stored workspaces (owner decision, 2026-10-25).
-- Clients before PR #267 could sync the key bag unencrypted; the Worker now drops it on write,
-- and this clears what is already stored. Only the `keys` member goes: `encryptedKeys`, the
-- storage map and updated_at (the workspace version) stay as they are. A row whose payload is not
-- valid JSON is skipped so it cannot fail the migration. Running it twice changes nothing.

UPDATE user_workspace
SET payload = json_remove(payload, '$.keys')
WHERE json_valid(payload) AND json_type(payload, '$.keys') IS NOT NULL;
