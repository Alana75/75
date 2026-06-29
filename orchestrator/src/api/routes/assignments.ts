import { Router }            from 'express';
import { z }                 from 'zod';
import { assignmentManager } from '../../assignments/AssignmentManager.js';
import { ok, error }         from '../middleware.js';

export const assignmentsRouter = Router({ mergeParams: true });

// GET /clients/:id/packages — list assigned packages
assignmentsRouter.get('/', (req, res) => {
  const { id } = req.params;
  const onlyEnabled = req.query.all !== 'true';
  const packages = assignmentManager.getClientPackages(id, onlyEnabled);
  res.json(ok(packages, { total: packages.length }));
});

// GET /clients/:id/packages/:package/access — quick access check
assignmentsRouter.get('/:package/access', (req, res) => {
  const { id, package: pkg } = req.params;
  const access = assignmentManager.hasAccess(id, pkg);
  res.json(ok({ clientId: id, packageName: pkg, access }));
});

// POST /clients/:id/packages — assign a package
const AssignSchema = z.object({
  packageName: z.string().min(1),
  enabled:     z.boolean().optional().default(true),
  config:      z.record(z.unknown()).optional().default({}),
  assignedBy:  z.string().optional(),
});

assignmentsRouter.post('/', (req, res) => {
  const parsed = AssignSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(error(parsed.error.message)); return; }
  try {
    const assignment = assignmentManager.assign({
      clientId: req.params.id,
      ...parsed.data,
    });
    res.status(201).json(ok(assignment));
  } catch (err) {
    res.status(400).json(error((err as Error).message));
  }
});

// POST /clients/:id/packages/bulk — assign multiple
assignmentsRouter.post('/bulk', (req, res) => {
  const { packageNames, assignedBy } = req.body as { packageNames: string[]; assignedBy?: string };
  if (!Array.isArray(packageNames)) {
    res.status(400).json(error('packageNames must be an array')); return;
  }
  const result = assignmentManager.bulkAssign(req.params.id, packageNames, assignedBy);
  res.json(ok(result));
});

// PATCH /clients/:id/packages/:package — toggle enabled
assignmentsRouter.patch('/:package', (req, res) => {
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') {
    res.status(400).json(error('enabled (boolean) is required')); return;
  }
  const changed = assignmentManager.toggle(req.params.id, req.params.package, enabled);
  if (!changed) { res.status(404).json(error('Assignment not found')); return; }
  res.json(ok({ clientId: req.params.id, packageName: req.params.package, enabled }));
});

// DELETE /clients/:id/packages/:package — revoke
assignmentsRouter.delete('/:package', (req, res) => {
  const revoked = assignmentManager.revoke(req.params.id, req.params.package);
  if (!revoked) { res.status(404).json(error('Assignment not found')); return; }
  res.json(ok({ revoked: true }));
});
