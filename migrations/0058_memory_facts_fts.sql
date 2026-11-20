-- Full-text index over memory_facts for ranked recall (worker/memoryRecall.ts, flag MEMORY_RECALL_V2).
-- Additive only. The index keeps its own copy of each fact's text keyed by fact id, so it does not
-- depend on memory_facts rowids. Triggers keep it in step with every insert, text update and delete,
-- including the privacy erase, which deletes memory_facts rows.

CREATE VIRTUAL TABLE IF NOT EXISTS memory_facts_fts USING fts5(
  fact_id UNINDEXED,
  text,
  tokenize = 'porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS memory_facts_fts_after_insert
AFTER INSERT ON memory_facts
BEGIN
  INSERT INTO memory_facts_fts (fact_id, text) VALUES (new.id, new.text);
END;

CREATE TRIGGER IF NOT EXISTS memory_facts_fts_after_delete
AFTER DELETE ON memory_facts
BEGIN
  DELETE FROM memory_facts_fts WHERE fact_id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS memory_facts_fts_after_update_text
AFTER UPDATE OF text ON memory_facts
BEGIN
  DELETE FROM memory_facts_fts WHERE fact_id = old.id;
  INSERT INTO memory_facts_fts (fact_id, text) VALUES (new.id, new.text);
END;

-- Index the facts that already exist.
INSERT INTO memory_facts_fts (fact_id, text)
SELECT id, text FROM memory_facts
WHERE id NOT IN (SELECT fact_id FROM memory_facts_fts);
