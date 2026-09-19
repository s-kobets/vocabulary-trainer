CREATE TABLE users (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

CREATE TABLE telegram_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  telegram_user_id TEXT NOT NULL UNIQUE,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE user_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  daily_review_enabled INTEGER NOT NULL DEFAULT 0 CHECK (daily_review_enabled IN (0, 1)),
  daily_review_time TEXT NOT NULL DEFAULT '09:00',
  last_daily_notification_at TEXT
);

CREATE TABLE language_pairs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_language TEXT NOT NULL,
  target_language TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_at TEXT NOT NULL,
  UNIQUE (user_id, source_language, target_language),
  UNIQUE (user_id, id)
);

CREATE UNIQUE INDEX language_pairs_one_default_per_user
  ON language_pairs(user_id)
  WHERE is_default = 1;

CREATE TABLE vocabulary_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  language_pair_id TEXT NOT NULL REFERENCES language_pairs(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  normalized_text TEXT NOT NULL,
  item_type TEXT NOT NULL CHECK (item_type IN ('word', 'phrase')),
  translations_json TEXT NOT NULL DEFAULT '[]',
  transcription TEXT,
  part_of_speech TEXT,
  examples_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('inbox', 'learning', 'known')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, language_pair_id, normalized_text),
  UNIQUE (user_id, id),
  FOREIGN KEY (user_id, language_pair_id) REFERENCES language_pairs(user_id, id) ON DELETE CASCADE
);

CREATE TABLE review_states (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vocabulary_item_id TEXT NOT NULL REFERENCES vocabulary_items(id) ON DELETE CASCADE,
  level INTEGER NOT NULL DEFAULT 0 CHECK (level BETWEEN 0 AND 6),
  next_review_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, vocabulary_item_id),
  FOREIGN KEY (user_id, vocabulary_item_id) REFERENCES vocabulary_items(user_id, id) ON DELETE CASCADE
);

CREATE TABLE reviews (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vocabulary_item_id TEXT NOT NULL REFERENCES vocabulary_items(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('source_to_target')),
  result TEXT NOT NULL CHECK (result IN ('correct', 'incorrect')),
  level_before INTEGER NOT NULL CHECK (level_before BETWEEN 0 AND 6),
  level_after INTEGER NOT NULL CHECK (level_after BETWEEN 0 AND 6),
  reviewed_at TEXT NOT NULL,
  FOREIGN KEY (user_id, vocabulary_item_id) REFERENCES vocabulary_items(user_id, id) ON DELETE CASCADE
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
