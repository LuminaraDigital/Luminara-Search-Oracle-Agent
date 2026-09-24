-- Persist display prefix for API keys (list must not derive from key_hash).
ALTER TABLE api_keys ADD COLUMN key_prefix TEXT;
