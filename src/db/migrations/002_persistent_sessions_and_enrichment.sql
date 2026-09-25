ALTER TABLE vocabulary_items ADD COLUMN enrichment_status TEXT NOT NULL DEFAULT 'ready'
  CHECK (enrichment_status IN ('pending', 'processing', 'ready'));
ALTER TABLE vocabulary_items ADD COLUMN enrichment_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE vocabulary_items ADD COLUMN enrichment_last_error TEXT;
ALTER TABLE vocabulary_items ADD COLUMN enriched_at TEXT;
ALTER TABLE vocabulary_items ADD COLUMN enrichment_next_retry_at TEXT;

CREATE TABLE telegram_sessions (
  telegram_user_id TEXT PRIMARY KEY,
  session_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT
);
