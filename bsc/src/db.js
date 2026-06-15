'use strict';

const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.BSC_DB || path.join(__dirname, '..', 'data', 'bsc.db');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
db.exec(`
CREATE TABLE IF NOT EXISTS departments (
  id    INTEGER PRIMARY KEY,
  key   TEXT UNIQUE NOT NULL,
  name  TEXT NOT NULL,
  color TEXT NOT NULL,
  sort  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS perspectives (
  id          INTEGER PRIMARY KEY,
  key         TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  description TEXT DEFAULT '',
  sort        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  pw_hash       TEXT NOT NULL,
  pw_salt       TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member',   -- admin | lead | member | viewer
  department_id INTEGER REFERENCES departments(id),
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS objectives (
  id             INTEGER PRIMARY KEY,
  perspective_id INTEGER NOT NULL REFERENCES perspectives(id),
  department_id  INTEGER REFERENCES departments(id),
  title          TEXT NOT NULL,
  description    TEXT DEFAULT '',
  sort           INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kpis (
  id            INTEGER PRIMARY KEY,
  objective_id  INTEGER NOT NULL REFERENCES objectives(id) ON DELETE CASCADE,
  department_id INTEGER REFERENCES departments(id),
  name          TEXT NOT NULL,
  unit          TEXT DEFAULT '',
  direction     TEXT NOT NULL DEFAULT 'up',        -- up = höher besser, down = niedriger besser
  target        REAL,
  green_at      REAL,                              -- ab hier grün
  yellow_at     REAL,                              -- ab hier gelb (sonst rot)
  frequency     TEXT DEFAULT 'monatlich',
  owner         TEXT DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS measurements (
  id         INTEGER PRIMARY KEY,
  kpi_id     INTEGER NOT NULL REFERENCES kpis(id) ON DELETE CASCADE,
  period     TEXT NOT NULL,                        -- z.B. 2026-05
  value      REAL NOT NULL,
  note       TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS initiatives (
  id            INTEGER PRIMARY KEY,
  objective_id  INTEGER REFERENCES objectives(id) ON DELETE SET NULL,
  department_id INTEGER REFERENCES departments(id),
  title         TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'offen',     -- offen | laufend | erledigt | gestoppt
  responsible   TEXT DEFAULT '',
  due_date      TEXT,
  progress      INTEGER NOT NULL DEFAULT 0,
  note          TEXT DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id),
  action     TEXT NOT NULL,
  detail     TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_meas_kpi    ON measurements(kpi_id, period);
CREATE INDEX IF NOT EXISTS idx_kpi_obj     ON kpis(objective_id);
CREATE INDEX IF NOT EXISTS idx_obj_persp   ON objectives(perspective_id);
CREATE INDEX IF NOT EXISTS idx_sess_user   ON sessions(user_id);
`);

module.exports = db;
