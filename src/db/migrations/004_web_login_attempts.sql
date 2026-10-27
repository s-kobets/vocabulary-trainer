CREATE TABLE web_login_attempts (
  id TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL
);

CREATE INDEX web_login_attempts_expiry ON web_login_attempts(expires_at);
