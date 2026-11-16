// db.js
// Opens (or creates) pillbox.sqlite and makes sure every table exists.
// better-sqlite3 is synchronous, which keeps route handlers simple —
// no async/await needed for queries.

const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'pillbox.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS medicines (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    dose         TEXT NOT NULL,
    time         TEXT NOT NULL,          -- 'HH:MM' 24h, e.g. '20:00'
    compartment  INTEGER NOT NULL,
    stock        INTEGER NOT NULL DEFAULT 0,
    days_left    INTEGER NOT NULL DEFAULT 0,
    status       TEXT NOT NULL DEFAULT 'good',  -- 'good' | 'low'
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS schedule_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    medicine_id INTEGER REFERENCES medicines(id) ON DELETE SET NULL,
    med_name    TEXT NOT NULL,           -- denormalized snapshot for display
    dose        TEXT NOT NULL,
    time        TEXT NOT NULL,
    instruction TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'upcoming', -- upcoming | taken | missed
    for_date    TEXT NOT NULL DEFAULT (date('now')),
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS alerts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type        TEXT NOT NULL,           -- red | amber | blue
    title       TEXT NOT NULL,
    description TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS history (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    medicine_name TEXT NOT NULL,
    scheduled_at  TEXT NOT NULL,
    taken_at      TEXT,
    status        TEXT NOT NULL,         -- taken | missed | upcoming
    log_date      TEXT NOT NULL DEFAULT (date('now'))
  );

  CREATE TABLE IF NOT EXISTS caregivers (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    relation   TEXT NOT NULL,
    notify_via TEXT NOT NULL DEFAULT 'Email',
    status     TEXT NOT NULL DEFAULT 'Invited', -- Invited | Active
    removable  INTEGER NOT NULL DEFAULT 1
  );
`);

// Migration: add device_api_key to users if this is an older database that
// doesn't have it yet. SQLite has no "ADD COLUMN IF NOT EXISTS", so check first.
// Note: SQLite also doesn't support "ADD COLUMN ... UNIQUE" directly — the
// column is added plain, and uniqueness is enforced via a separate index.
const userColumns = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
if (!userColumns.includes('device_api_key')) {
  db.exec('ALTER TABLE users ADD COLUMN device_api_key TEXT');
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_device_key ON users(device_api_key) WHERE device_api_key IS NOT NULL');

module.exports = db;
