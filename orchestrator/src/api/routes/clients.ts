import { Router }          from 'express';
import { z }               from 'zod';
import { clientRegistry }  from '../../clients/ClientRegistry.js';
import { ok, error }       from '../middleware.js';

export const clientsRouter = Router();

// GET /clients
clientsRouter.get('/', (req, res) => {
  const { active, tier } = req.query as Record<string, string>;
  const clients = clientRegistry.list({
    ...(active !== undefined ? { active: active === 'true' } : {}),
    ...(tier ? { tier } : {}),
  });
  res.json(ok(clients, { total: clients.length }));
});

// GET /clients/:id
clientsRouter.get('/:id', (req, res) => {
  const client = clientRegistry.get(req.params.id)
               ?? clientRegistry.getBySlug(req.params.id); // allow slug lookup too
  if (!client) { res.status(404).json(error('Client not found')); return; }
  res.json(ok(client));
});

// POST /clients
const CreateClientSchema = z.object({
  name:   z.string().min(1).max(120),
  slug:   z.string().min(2).max(60).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  domain: z.string().url().optional(),
  email:  z.string().email().optional(),
  tier:   z.enum(['free', 'professional', 'enterprise']).optional(),
});

clientsRouter.post('/', (req, res) => {
  const parsed = CreateClientSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(error(parsed.error.message)); return; }
  try {
    const client = clientRegistry.create(parsed.data);
    res.status(201).json(ok(client));
  } catch (err) {
    res.status(409).json(error((err as Error).message));
  }
});

// PATCH /clients/:id
clientsRouter.patch('/:id', (req, res) => {
  const updated = clientRegistry.update(req.params.id, req.body);
  if (!updated) { res.status(404).json(error('Client not found')); return; }
  res.json(ok(updated));
});

// DELETE /clients/:id (soft deactivate)
clientsRouter.delete('/:id', (req, res) => {
  const hard = req.query.hard === 'true';
  const ok2  = hard
    ? clientRegistry.delete(req.params.id)
    : clientRegistry.deactivate(req.params.id);
  if (!ok2) { res.status(404).json(error('Client not found')); return; }
  res.json(ok({ deleted: true, hard }));
});
