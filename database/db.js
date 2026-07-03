CREATE TABLE IF NOT EXISTS active_lockdown (
  id INT PRIMARY KEY DEFAULT 1,
  incident_id TEXT,
  level INT,
  reason TEXT
);

CREATE TABLE IF NOT EXISTS snapshots (
  incident_id TEXT PRIMARY KEY,
  data TEXT NOT NULL
);
