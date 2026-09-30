ALTER TABLE user_settings ADD COLUMN daily_review_attempt_date TEXT;
ALTER TABLE user_settings ADD COLUMN daily_review_delivered_date TEXT;
ALTER TABLE user_settings ADD COLUMN daily_review_attempt_count INTEGER NOT NULL DEFAULT 0
  CHECK (daily_review_attempt_count BETWEEN 0 AND 3);
ALTER TABLE user_settings ADD COLUMN daily_review_last_attempt_at TEXT;
