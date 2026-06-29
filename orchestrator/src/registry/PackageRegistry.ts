/**
 * PackageRegistry — the single source of truth for all Ralph packages.
 * Backed by SQLite. Thread-safe via better-sqlite3 synchronous API.
 */
import { randomUUID } from 'crypto';
import { getDb }      from '../storage/db.js';
import type { RalphPackage, PackageManifest, PackageStatus } from '../types/index.js';

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function rowToPackage(row: Record<string, unknown>): RalphPackage {
  return {
    name:         row.name         as string,
    version:      row.version      as string,
    description:  row.description  as string,
    route:        row.route        as string,
    entry:        row.entry        as string,
    type:         row.type         as RalphPackage['type'],
    icon:         row.icon         as string | undefined,
    label:        row.label        as string | undefined,
    tags:         JSON.parse((row.tags as string) || '[]'),
    tier:         row.tier         as RalphPackage['tier'],
    status:       row.status       as PackageStatus,
    registeredAt: row.registered_at as string,
    updatedAt:    row.updated_at    as string,
  };
}

// ─── REGISTRY ────────────────────────────────────────────────────────────────

export class PackageRegistry {
  // ── List ──────────────────────────────────────────────────
  list(filter?: { status?: PackageStatus; type?: string }): RalphPackage[] {
    const db = getDb();
    let sql  = 'SELECT * FROM packages';
    const params: string[] = [];

    const where: string[] = [];
    if (filter?.status) { where.push('status = ?'); params.push(filter.status); }
    if (filter?.type)   { where.push('type = ?');   params.push(filter.type); }
    if (where.length)   sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY name ASC';

    return (db.prepare(sql).all(...params) as Record<string, unknown>[]).map(rowToPackage);
  }

  // ── Get ───────────────────────────────────────────────────
  get(name: string): RalphPackage | null {
    const row = getDb().prepare('SELECT * FROM packages WHERE name = ?').get(name) as Record<string, unknown> | undefined;
    return row ? rowToPackage(row) : null;
  }

  // ── Register / Upsert ─────────────────────────────────────
  register(manifest: PackageManifest): RalphPackage {
    const db  = getDb();
    const now = new Date().toISOString();

    const existing = this.get(manifest.name);

    if (existing) {
      // Update — preserve status and registeredAt
      db.prepare(`
        UPDATE packages SET
          version     = ?,
          description = ?,
          route       = ?,
          entry       = ?,
          type        = ?,
          icon        = ?,
          label       = ?,
          tags        = ?,
          tier        = ?,
          updated_at  = ?
        WHERE name = ?
      `).run(
        manifest.version     ?? existing.version,
        manifest.description ?? existing.description,
        manifest.route,
        manifest.entry       ?? existing.entry,
        manifest.type        ?? existing.type ?? 'service',
        manifest.icon        ?? existing.icon ?? null,
        manifest.label       ?? existing.label ?? null,
        JSON.stringify(manifest.tags ?? existing.tags ?? []),
        manifest.tier        ?? existing.tier ?? 'free',
        now,
        manifest.name,
      );
    } else {
      // Insert new
      db.prepare(`
        INSERT INTO packages
          (name, version, description, route, entry, type, icon, label, tags, tier, status, registered_at, updated_at)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
      `).run(
        manifest.name,
        manifest.version     ?? '0.0.1',
        manifest.description ?? '',
        manifest.route,
        manifest.entry       ?? '',
        manifest.type        ?? 'service',
        manifest.icon        ?? null,
        manifest.label       ?? null,
        JSON.stringify(manifest.tags ?? []),
        manifest.tier        ?? 'free',
        now,
        now,
      );
    }

    return this.get(manifest.name)!;
  }

  // ── Set Status ────────────────────────────────────────────
  setStatus(name: string, status: PackageStatus): boolean {
    const result = getDb().prepare(
      `UPDATE packages SET status = ?, updated_at = ? WHERE name = ?`
    ).run(status, new Date().toISOString(), name);
    return result.changes > 0;
  }

  // ── Enable / Disable ──────────────────────────────────────
  enable(name: string):  boolean { return this.setStatus(name, 'active');   }
  disable(name: string): boolean { return this.setStatus(name, 'inactive'); }

  // ── Delete ────────────────────────────────────────────────
  delete(name: string): boolean {
    const result = getDb().prepare('DELETE FROM packages WHERE name = ?').run(name);
    return result.changes > 0;
  }

  count(): number {
    return (getDb().prepare('SELECT COUNT(*) as n FROM packages').get() as { n: number }).n;
  }
}

export const packageRegistry = new PackageRegistry();
