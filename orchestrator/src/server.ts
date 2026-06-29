/**
 * @ralph/package-orchestrator — HTTP Server
 * Runs standalone on ORCHESTRATOR_PORT (default: 4020)
 * Can also be embedded into the ralph-analytics Express app.
 */
import express        from 'express';
import cors           from 'cors';
import helmet         from 'helmet';
import { apiRouter }  from './api/router.js';
import { errorHandler, notFound } from './api/middleware.js';
import { packageLoader }          from './loader/PackageLoader.js';
import { closeDb }                from './storage/db.js';

const PORT = parseInt(process.env.ORCHESTRATOR_PORT ?? '4020', 10);

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') ?? '*' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

// ── Mount orchestrator API ────────────────────────────────────
app.use('/api', apiRouter);

// ── Fallbacks ─────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ── Startup ───────────────────────────────────────────────────
function start(): void {
  // Auto-sync packages on startup
  try {
    const sync = packageLoader.sync();
    console.log(`[orchestrator] Startup sync: ${sync.registered} new, ${sync.updated} updated`);
  } catch (err) {
    console.warn('[orchestrator] Startup sync failed:', (err as Error).message);
  }

  const server = app.listen(PORT, () => {
    console.log(`[orchestrator] ✅ Listening on port ${PORT}`);
    console.log(`[orchestrator]    Health: http://localhost:${PORT}/api/health`);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('[orchestrator] Shutting down...');
    server.close(() => {
      closeDb();
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT',  shutdown);
}

start();

export { app };
