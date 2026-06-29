/**
 * Main API router — wires all route modules together.
 */
import { Router }            from 'express';
import { requireApiKey, ok } from './middleware.js';
import { packagesRouter }    from './routes/packages.js';
import { clientsRouter }     from './routes/clients.js';
import { assignmentsRouter } from './routes/assignments.js';
import { packageRegistry }   from '../registry/PackageRegistry.js';
import { clientRegistry }    from '../clients/ClientRegistry.js';
import { assignmentManager } from '../assignments/AssignmentManager.js';

export const apiRouter = Router();

// ── Health (public) ───────────────────────────────────────────
apiRouter.get('/health', (_req, res) => {
  res.json(ok({
    status:   'ok',
    service:  '@ralph/package-orchestrator',
    version:  '1.0.0',
    counts: {
      packages:    packageRegistry.count(),
      clients:     clientRegistry.count(),
      assignments: assignmentManager.count(),
    },
    uptime: process.uptime(),
    time:   new Date().toISOString(),
  }));
});

// ── Protected routes ──────────────────────────────────────────
apiRouter.use(requireApiKey);

apiRouter.use('/packages',                    packagesRouter);
apiRouter.use('/clients',                     clientsRouter);
apiRouter.use('/clients/:id/packages',        assignmentsRouter);
