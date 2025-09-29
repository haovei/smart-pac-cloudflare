-- D1 migration: initialize schema for Smart PAC service
CREATE TABLE IF NOT EXISTS hosts (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT,
	host TEXT NOT NULL,
	port INTEGER NOT NULL,
	type TEXT NOT NULL DEFAULT 'PROXY'
);

CREATE TABLE IF NOT EXISTS rules (
	rule TEXT PRIMARY KEY,
	host_ids TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_hosts_name ON hosts(name);
CREATE INDEX IF NOT EXISTS idx_rules_rule ON rules(rule);
