import { Router }           from 'express';
import { z }                from 'zod';
import { packageRegistry }  from '../../registry/PackageRegistry.js';
import { packageLoader }    from '../../loader/PackageLoader.js';
import { ok, error }        from '../middleware.js';

export const packagesRouter = Router();

// GET /packages — list all packages
packagesRouter.get('/', (req, res) => {
  const { status, type } = req.query as Record<string, string>;
  const packages = packageRegistry.list({
    ...(status ? { status: status as any } : {}),
    ...(type   ? { type }                 : {}),
  });
  res.json(ok(packages, { total: packages.length }));
});

// GET /packages/:name
packagesRouter.get('/:name', (req, res) => {
  const pkg = packageRegistry.get(req.params.name);
  if (!pkg) { res.status(404).json(error(`Package '${req.params.name}' not found`)); return; }
  res.json(ok(pkg));
});

// POST /packages/register
const RegisterSchema = z.object({
  name:        z.string().min(1),
  version:     z.string().optional(),
  description: z.string().optional(),
  route:       z.string().startsWith('/'),
  entry:       z.string().optional(),
  type:        z.enum(['frontend', 'api', 'service', 'hybrid']).optional(),
  icon:        z.string().optional(),
  label:       z.string().optional(),
  tags:        z.array(z.string()).optional(),
  tier:        z.enum(['free', 'professional', 'enterprise']).optional(),
});

packagesRouter.post('/register', (req, res) => {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(error(parsed.error.message)); return; }
  const pkg = packageRegistry.register(parsed.data);
  res.status(201).json(ok(pkg));
});

// POST /packages/sync — auto-discover
packagesRouter.post('/sync', (_req, res) => {
  const result = packageLoader.sync();
  res.json(ok(result));
});

// PATCH /packages/:name/status
packagesRouter.patch('/:name/status', (req, res) => {
  const { status } = req.body;
  if (!['active', 'inactive'].includes(status)) {
    res.status(400).json(error("status must be 'active' or 'inactive'")); return;
  }
  const changed = packageRegistry.setStatus(req.params.name, status);
  if (!changed) { res.status(404).json(error(`Package '${req.params.name}' not found`)); return; }
  res.json(ok({ name: req.params.name, status }));
});

// DELETE /packages/:name
packagesRouter.delete('/:name', (req, res) => {
  const deleted = packageRegistry.delete(req.params.name);
  if (!deleted) { res.status(404).json(error(`Package '${req.params.name}' not found`)); return; }
  res.json(ok({ deleted: true }));
});
