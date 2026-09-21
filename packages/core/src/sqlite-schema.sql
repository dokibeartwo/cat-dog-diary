-- SQLite adapter contract for device storage. The JS tests use MemorySyncStore
-- from local-store.js, while Android can map these same columns to SQLite.
CREATE TABLE IF NOT EXISTS sync_entities (
  account_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  device_id TEXT NOT NULL,
  last_mutation_id TEXT,
  PRIMARY KEY (account_id, entity_type, entity_id)
);
CREATE TABLE IF NOT EXISTS sync_outbox (
  mutation_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  patch_json TEXT NOT NULL,
  base_payload_json TEXT NOT NULL DEFAULT '{}',
  base_revision INTEGER NOT NULL DEFAULT 0,
  occurrence_key TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_meta (
  account_id TEXT PRIMARY KEY,
  cursor INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_conflicts (
  conflict_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  fields_json TEXT NOT NULL,
  local_json TEXT NOT NULL,
  remote_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS sync_entities_account_updated ON sync_entities(account_id, updated_at);
CREATE INDEX IF NOT EXISTS sync_outbox_account_created ON sync_outbox(account_id, created_at);
