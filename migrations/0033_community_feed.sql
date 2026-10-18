-- Track SW, SW0a-9: the community idea feed moves out of one KV value into D1.
-- The KV feed carried each sharer's account id, let any account publish another account's idea
-- card by id, counted votes with no voter, and seeded two cards with made-up vote counts.
--
-- A card is a copy of an idea card its owner chose to share, under its own id. The feed's public
-- id is `id`, never `idea_id`, and the routes select named columns and never `account_id`.
-- A card's vote count is COUNT(*) over its votes: there is no counter column to drift or to seed.
-- One vote per account per card is the primary key.
-- `status` lets a reported card be hidden without deleting the row (plan section 14.6).
-- `utc_day` is what the daily share cap counts, inside the insert.
--
-- Rows are exported with the account. Deleting an account deletes every vote on its cards, then
-- its own votes, then its cards, in one batch. On account link, cards and votes move to the
-- surviving account; a collision keeps the surviving account's row.
-- COMMUNITY_FEED_ENABLED stays "false" until the chat rules and a named moderator exist.

CREATE TABLE IF NOT EXISTS community_feed_cards (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  idea_id TEXT NOT NULL,
  idea_text TEXT NOT NULL CHECK (length(idea_text) BETWEEN 1 AND 500),
  niche TEXT,
  card_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible','hidden','removed')),
  utc_day TEXT NOT NULL,
  shared_at INTEGER NOT NULL,
  UNIQUE (account_id, idea_id)
);
CREATE INDEX IF NOT EXISTS idx_community_feed_recent ON community_feed_cards(status, shared_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_feed_account ON community_feed_cards(account_id, utc_day);

CREATE TABLE IF NOT EXISTS community_feed_votes (
  card_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (card_id, account_id)
);
CREATE INDEX IF NOT EXISTS idx_community_feed_votes_account ON community_feed_votes(account_id);
