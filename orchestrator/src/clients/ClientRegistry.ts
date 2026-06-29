/**
 * ClientRegistry — manages Ralph platform clients (tenants).
 */
import { getDb } from '../storage/db.js';
import type { Client } from '../types/index.js';

function cuid(): string {
  return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

function rowToClient(row: Record<string, unknown>): Client {
  return {
    id:        row.id        as string,
    name:      row.name      as string,
    slug:      row.slug      as string,
    domain:    row.domain    as string | undefined,
    email:     row.email     as string | undefined,
    tier:      row.tier      as Client['tier'],
    active:    Boolean(row.active),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export class ClientRegistry {
  // ── List ──────────────────────────────────────────────────
  list(filter?: { active?: boolean; tier?: string }): Client[] {
    const db = getDb();
    let sql = 'SELECT * FROM clients';
    const params: (string | number)[] = [];
    const where: string[] = [];

    if (filter?.active !== undefined) { where.push('active = ?'); params.push(filter.active ? 1 : 0); }
    if (filter?.tier)                 { where.push('tier = ?');   params.push(filter.tier); }
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY name ASC';

    return (db.prepare(sql).all(...params) as Record<string, unknown>[]).map(rowToClient);
  }

  // ── Get by ID ─────────────────────────────────────────────
  get(id: string): Client | null {
    const row = getDb().prepare('SELECT * FROM clients WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? rowToClient(row) : null;
  }

  // ── Get by slug ───────────────────────────────────────────
  getBySlug(slug: string): Client | null {
    const row = getDb().prepare('SELECT * FROM clients WHERE slug = ?').get(slug) as Record<string, unknown> | undefined;
    return row ? rowToClient(row) : null;
  }

  // ── Create ────────────────────────────────────────────────
  create(input: {
    name:    string;
    slug:    string;
    domain?: string;
    email?:  string;
    tier?:   Client['tier'];
  }): Client {
    const db  = getDb();
    const now = new Date().toISOString();
    const id  = cuid();

    // Validate slug uniqueness
    if (this.getBySlug(input.slug)) {
      throw new Error(`Client slug '${input.slug}' already exists`);
    }

    db.prepare(`
      INSERT INTO clients (id, name, slug, domain, email, tier, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      id,
      input.name,
      input.slug,
      input.domain ?? null,
      input.email  ?? null,
      input.tier   ?? 'free',
      now,
      now,
    );

    return this.get(id)!;
  }

  // ── Update ────────────────────────────────────────────────
  update(id: string, patch: Partial<Omit<Client, 'id' | 'createdAt' | 'updatedAt'>>): Client | null {
    const existing = this.get(id);
    if (!existing) return null;

    const now = new Date().toISOString();
    getDb().prepare(`
      UPDATE clients SET
        name       = ?,
        slug       = ?,
        domain     = ?,
        email      = ?,
        tier       = ?,
        active     = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      patch.name   ?? existing.name,
      patch.slug   ?? existing.slug,
      patch.domain ?? existing.domain ?? null,
      patch.email  ?? existing.email  ?? null,
      patch.tier   ?? existing.tier,
      patch.active !== undefined ? (patch.active ? 1 : 0) : (existing.active ? 1 : 0),
      now,
      id,
    );

    return this.get(id);
  }

  // ── Deactivate (soft delete) ──────────────────────────────
  deactivate(id: string): boolean {
    const result = getDb().prepare(
      `UPDATE clients SET active = 0, updated_at = ? WHERE id = ?`
    ).run(new Date().toISOString(), id);
    return result.changes > 0;
  }

  // ── Hard delete ───────────────────────────────────────────
  delete(id: string): boolean {
    const result = getDb().prepare('DELETE FROM clients WHERE id = ?').run(id);
    return result.changes > 0;
  }

  count(): number {
    return (getDb().prepare('SELECT COUNT(*) as n FROM clients').get() as { n: number }).n;
  }
}

export const clientRegistry = new ClientRegistry();
