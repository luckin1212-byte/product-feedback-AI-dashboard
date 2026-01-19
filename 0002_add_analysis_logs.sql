-- Migration: Add analysis logs table for tracking daily analysis results
CREATE TABLE IF NOT EXISTS analysis_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  total_feedback INTEGER NOT NULL DEFAULT 0,
  negative_count INTEGER NOT NULL DEFAULT 0,
  p0_count INTEGER NOT NULL DEFAULT 0,
  p1_count INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for efficient querying
CREATE INDEX IF NOT EXISTS idx_analysis_logs_timestamp
  ON analysis_logs(timestamp);

CREATE INDEX IF NOT EXISTS idx_analysis_logs_created_at
  ON analysis_logs(created_at);
