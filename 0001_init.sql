CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  raw_text TEXT NOT NULL,
  sentiment TEXT,
  priority TEXT,
  category TEXT,
  summary TEXT,
  priority_reason TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_feedback_created_at
  ON feedback(created_at);

CREATE INDEX IF NOT EXISTS idx_feedback_priority
  ON feedback(priority);

CREATE INDEX IF NOT EXISTS idx_feedback_sentiment
  ON feedback(sentiment);
