/**
 * SQLite storage layer for the Package Orchestrator.
 * Uses better-sqlite3 — synchronous, zero-config, battle-tested.
 * DB file lives at: process.env.ORCHESTRATOR_DB_PATH || './data/orchestrator.db'
 */
import Database from 'better-sqlite3';
import { join, dirname }  from 'path';
import { fileURLToPath }  from 'url';
import { existsSync, mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveDbPath(): string {
  if (process.env.ORCHESTRATOR_DB_PATH) return process.env.ORCHESTRATOR_DB_PATH;
  // Resolve relative to package root (two levels up from src/storage/)
  const root = join(__dirname, '../../data');
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  return join(root, 'orchestrator.db');
}

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  const path = resolveDbPath();
  _db = new Database(path);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  runMigrations(_db);
  return _db;
}

// ─── MIGRATIONS ──────────────────────────────────────────────────────────────

function runMigrations(db: Database.Database): void {
  db.exec(`
    -- Schema versioning
    CREATE TABLE IF NOT EXISTS _migrations (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL UNIQUE,
      applied_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- Packages registry
    CREATE TABLE IF NOT EXISTS packages (
      name          TEXT    PRIMARY KEY,
      version       TEXT    NOT NULL,
      description   TEXT    NOT NULL DEFAULT '',
      route         TEXT    NOT NULL,
      entry         TEXT    NOT NULL DEFAULT '',
      type          TEXT    NOT NULL DEFAULT 'service',
      icon          TEXT,
      label         TEXT,
      tags          TEXT    NOT NULL DEFAULT '[]',   -- JSON array
      tier          TEXT    NOT NULL DEFAULT 'free',
      status        TEXT    NOT NULL DEFAULT 'active',
      registered_at TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- Clients
    CREATE TABLE IF NOT EXISTS clients (
      id         TEXT    PRIMARY KEY,
      name       TEXT    NOT NULL,
      slug       TEXT    NOT NULL UNIQUE,
      domain     TEXT,
      email      TEXT,
      tier       TEXT    NOT NULL DEFAULT 'free',
      active     INTEGER NOT NULL DEFAULT 1,
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- Package assignments (client ↔ package)
    CREATE TABLE IF NOT EXISTS assignments (
      id           TEXT    PRIMARY KEY,
      client_id    TEXT    NOT NULL REFERENCES clients(id)  ON DELETE CASCADE,
      package_name TEXT    NOT NULL REFERENCES packages(name) ON DELETE CASCADE,
      enabled      INTEGER NOT NULL DEFAULT 1,
      config       TEXT    NOT NULL DEFAULT '{}',  -- JSON blob
      assigned_by  TEXT,
      assigned_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(client_id, package_name)
    );

    CREATE INDEX IF NOT EXISTS idx_assignments_client   ON assignments(client_id);
    CREATE INDEX IF NOT EXISTS idx_assignments_package  ON assignments(package_name);
    CREATE INDEX IF NOT EXISTS idx_clients_slug         ON clients(slug);
    CREATE INDEX IF NOT EXISTS idx_packages_status      ON packages(status);
  `);
}

/** Close the DB connection (call on process exit) */
export function closeDb(): void {
  _db?.close();
  _db = null;
}
