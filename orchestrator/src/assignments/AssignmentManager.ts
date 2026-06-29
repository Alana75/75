/**
 * AssignmentManager — controls which packages are available to which clients.
 * This is the access control layer.
 */
import { getDb }          from '../storage/db.js';
import { packageRegistry } from '../registry/PackageRegistry.js';
import { clientRegistry }  from '../clients/ClientRegistry.js';
import type { ClientPackageAssignment, PackageWithAssignment } from '../types/index.js';

function cuid(): string {
  return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

function rowToAssignment(row: Record<string, unknown>): ClientPackageAssignment {
  return {
    id:          row.id          as string,
    clientId:    row.client_id   as string,
    packageName: row.package_name as string,
    enabled:     Boolean(row.enabled),
    config:      JSON.parse((row.config as string) || '{}'),
    assignedBy:  row.assigned_by  as string | undefined,
    assignedAt:  row.assigned_at  as string,
    updatedAt:   row.updated_at   as string,
  };
}

export class AssignmentManager {

  // ── List all assignments for a client ─────────────────────
  getClientAssignments(clientId: string): ClientPackageAssignment[] {
    const rows = getDb()
      .prepare('SELECT * FROM assignments WHERE client_id = ? ORDER BY assigned_at DESC')
      .all(clientId) as Record<string, unknown>[];
    return rows.map(rowToAssignment);
  }

  // ── Get packages available to a client (with access check) ─
  getClientPackages(clientId: string, onlyEnabled = true): PackageWithAssignment[] {
    const db = getDb();

    const sql = `
      SELECT p.*, a.id as a_id, a.enabled as a_enabled, a.config as a_config,
             a.assigned_by, a.assigned_at, a.updated_at as a_updated
      FROM packages p
      INNER JOIN assignments a ON p.name = a.package_name
      WHERE a.client_id = ?
        AND p.status = 'active'
        ${onlyEnabled ? "AND a.enabled = 1" : ""}
      ORDER BY p.name ASC
    `;

    const rows = db.prepare(sql).all(clientId) as Record<string, unknown>[];

    return rows.map(row => ({
      name:         row.name         as string,
      version:      row.version      as string,
      description:  row.description  as string,
      route:        row.route        as string,
      entry:        row.entry        as string,
      type:         row.type         as PackageWithAssignment['type'],
      icon:         row.icon         as string | undefined,
      label:        row.label        as string | undefined,
      tags:         JSON.parse((row.tags as string) || '[]'),
      tier:         row.tier         as PackageWithAssignment['tier'],
      status:       row.status       as PackageWithAssignment['status'],
      registeredAt: row.registered_at as string,
      updatedAt:    row.updated_at    as string,
      assignment: {
        id:          row.a_id         as string,
        clientId,
        packageName: row.name         as string,
        enabled:     Boolean(row.a_enabled),
        config:      JSON.parse((row.a_config as string) || '{}'),
        assignedBy:  row.assigned_by  as string | undefined,
        assignedAt:  row.assigned_at  as string,
        updatedAt:   row.a_updated    as string,
      },
    }));
  }

  // ── Check access ──────────────────────────────────────────
  hasAccess(clientId: string, packageName: string): boolean {
    const row = getDb().prepare(`
      SELECT 1 FROM assignments a
      INNER JOIN packages p ON p.name = a.package_name
      WHERE a.client_id = ? AND a.package_name = ? AND a.enabled = 1 AND p.status = 'active'
    `).get(clientId, packageName);
    return !!row;
  }

  // ── Assign package to client ──────────────────────────────
  assign(input: {
    clientId:    string;
    packageName: string;
    config?:     Record<string, unknown>;
    assignedBy?: string;
    enabled?:    boolean;
  }): ClientPackageAssignment {
    // Validate client and package exist
    if (!clientRegistry.get(input.clientId)) {
      throw new Error(`Client '${input.clientId}' not found`);
    }
    if (!packageRegistry.get(input.packageName)) {
      throw new Error(`Package '${input.packageName}' not found`);
    }

    const db  = getDb();
    const now = new Date().toISOString();
    const id  = cuid();

    // Upsert — if already assigned, update config/enabled
    const existing = db.prepare(
      'SELECT * FROM assignments WHERE client_id = ? AND package_name = ?'
    ).get(input.clientId, input.packageName) as Record<string, unknown> | undefined;

    if (existing) {
      db.prepare(`
        UPDATE assignments SET
          enabled     = ?,
          config      = ?,
          assigned_by = ?,
          updated_at  = ?
        WHERE client_id = ? AND package_name = ?
      `).run(
        input.enabled !== false ? 1 : 0,
        JSON.stringify(input.config ?? {}),
        input.assignedBy ?? null,
        now,
        input.clientId,
        input.packageName,
      );
      return rowToAssignment(
        db.prepare('SELECT * FROM assignments WHERE client_id = ? AND package_name = ?')
          .get(input.clientId, input.packageName) as Record<string, unknown>
      );
    }

    db.prepare(`
      INSERT INTO assignments (id, client_id, package_name, enabled, config, assigned_by, assigned_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.clientId,
      input.packageName,
      input.enabled !== false ? 1 : 0,
      JSON.stringify(input.config ?? {}),
      input.assignedBy ?? null,
      now,
      now,
    );

    return this.getClientAssignments(input.clientId).find(a => a.packageName === input.packageName)!;
  }

  // ── Toggle enabled/disabled ───────────────────────────────
  toggle(clientId: string, packageName: string, enabled: boolean): boolean {
    const result = getDb().prepare(`
      UPDATE assignments SET enabled = ?, updated_at = ?
      WHERE client_id = ? AND package_name = ?
    `).run(enabled ? 1 : 0, new Date().toISOString(), clientId, packageName);
    return result.changes > 0;
  }

  // ── Revoke (remove assignment) ────────────────────────────
  revoke(clientId: string, packageName: string): boolean {
    const result = getDb().prepare(
      'DELETE FROM assignments WHERE client_id = ? AND package_name = ?'
    ).run(clientId, packageName);
    return result.changes > 0;
  }

  // ── Bulk assign ───────────────────────────────────────────
  bulkAssign(clientId: string, packageNames: string[], assignedBy?: string): { assigned: string[]; skipped: string[] } {
    const assigned: string[] = [];
    const skipped:  string[] = [];

    for (const name of packageNames) {
      try {
        this.assign({ clientId, packageName: name, assignedBy });
        assigned.push(name);
      } catch {
        skipped.push(name);
      }
    }

    return { assigned, skipped };
  }

  count(): number {
    return (getDb().prepare('SELECT COUNT(*) as n FROM assignments').get() as { n: number }).n;
  }
}

export const assignmentManager = new AssignmentManager();
