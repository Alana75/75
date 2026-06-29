/**
 * API middleware — auth, error handling, response helpers.
 */
import { Request, Response, NextFunction } from 'express';
import type { ApiResponse } from '../types/index.js';

// ─── API KEY AUTH ─────────────────────────────────────────────────────────────

export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const key = req.headers['x-api-key'] ?? req.query['api_key'];
  const expected = process.env.ORCHESTRATOR_API_KEY;

  if (!expected) {
    // No key configured — allow in dev, block in prod
    if (process.env.NODE_ENV === 'production') {
      res.status(503).json(error('ORCHESTRATOR_API_KEY not configured'));
      return;
    }
    next();
    return;
  }

  if (key !== expected) {
    res.status(401).json(error('Invalid or missing API key'));
    return;
  }
  next();
}

// ─── RESPONSE HELPERS ────────────────────────────────────────────────────────

export function ok<T>(data: T, meta?: ApiResponse['meta']): ApiResponse<T> {
  return { success: true, data, ...(meta ? { meta } : {}) };
}

export function error(message: string): ApiResponse {
  return { success: false, error: message };
}

// ─── ERROR HANDLER ────────────────────────────────────────────────────────────

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  console.error('[orchestrator]', err.message);
  res.status(500).json(error(err.message));
}

// ─── NOT FOUND ────────────────────────────────────────────────────────────────

export function notFound(_req: Request, res: Response): void {
  res.status(404).json(error('Route not found'));
}
