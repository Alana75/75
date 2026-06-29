/**
 * PackageLoader — discovers Ralph packages in the monorepo/node_modules
 * and registers them in the PackageRegistry.
 *
 * Discovery strategy (in order):
 *   1. Local packages/ directory (monorepo — checks for metadata export)
 *   2. node_modules/@ralph/* (installed packages)
 *   3. ORCHESTRATOR_PACKAGE_PATHS env var (colon-separated extra paths)
 */
import { readdirSync, existsSync, readFileSync } from 'fs';
import { join, resolve, dirname }               from 'path';
import { fileURLToPath }                         from 'url';
import { packageRegistry }                       from '../registry/PackageRegistry.js';
import type { PackageManifest }                  from '../types/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── MANIFEST EXTRACTION ─────────────────────────────────────────────────────

/**
 * Reads a package directory and extracts a PackageManifest.
 * Looks for:
 *   1. package.json → { ralph: { route, type, icon, tags, tier } }
 *   2. src/manifest.ts or src/metadata.ts exporting `metadata`
 */
function extractManifest(packageDir: string): PackageManifest | null {
  const pkgJsonPath = join(packageDir, 'package.json');
  if (!existsSync(pkgJsonPath)) return null;

  let pkgJson: Record<string, unknown>;
  try {
    pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
  } catch {
    return null;
  }

  const name    = pkgJson.name as string;
  const version = pkgJson.version as string ?? '0.0.1';

  // Must be a @ralph/* scoped package with a ralph config block
  if (!name?.startsWith('@ralph/') && !name?.startsWith('ralph-')) return null;

  const ralphConfig = (pkgJson.ralph ?? pkgJson.metadata ?? {}) as Record<string, unknown>;

  // Must have at minimum a route
  if (!ralphConfig.route) return null;

  return {
    name,
    version,
    description: (pkgJson.description as string) ?? '',
    route:       ralphConfig.route       as string,
    type:        (ralphConfig.type       as PackageManifest['type']) ?? 'service',
    icon:        ralphConfig.icon        as string | undefined,
    label:       ralphConfig.label       as string | undefined,
    tags:        (ralphConfig.tags       as string[]) ?? [],
    tier:        (ralphConfig.tier       as PackageManifest['tier']) ?? 'free',
    entry:       (pkgJson.main           as string) ?? '',
  };
}

// ─── LOADER ──────────────────────────────────────────────────────────────────

export interface SyncResult {
  discovered: number;
  registered: number;
  updated:    number;
  errors:     Array<{ path: string; error: string }>;
}

export class PackageLoader {
  private monorepoRoot: string;

  constructor(monorepoRoot?: string) {
    // Walk up from packages/ralph-package-orchestrator to repo root
    this.monorepoRoot = monorepoRoot
      ?? resolve(__dirname, '../../../../');
  }

  // ── Discovery paths ───────────────────────────────────────
  private getSearchPaths(): string[] {
    const paths: string[] = [
      join(this.monorepoRoot, 'packages'),
    ];

    // node_modules/@ralph (installed packages)
    const nmRalph = join(this.monorepoRoot, 'node_modules', '@ralph');
    if (existsSync(nmRalph)) paths.push(nmRalph);

    // Extra paths from env
    const extra = process.env.ORCHESTRATOR_PACKAGE_PATHS;
    if (extra) paths.push(...extra.split(':').filter(Boolean));

    return paths;
  }

  // ── Scan a single directory ───────────────────────────────
  private scanDir(dir: string): PackageManifest[] {
    if (!existsSync(dir)) return [];

    const manifests: PackageManifest[] = [];
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const manifest = extractManifest(join(dir, entry.name));
        if (manifest) manifests.push(manifest);
      }
    } catch {
      // ignore unreadable dirs
    }
    return manifests;
  }

  // ── Full sync ─────────────────────────────────────────────
  sync(): SyncResult {
    const result: SyncResult = { discovered: 0, registered: 0, updated: 0, errors: [] };
    const seen = new Set<string>();

    for (const searchPath of this.getSearchPaths()) {
      const manifests = this.scanDir(searchPath);
      result.discovered += manifests.length;

      for (const manifest of manifests) {
        if (seen.has(manifest.name)) continue; // dedupe
        seen.add(manifest.name);

        try {
          const existing = packageRegistry.get(manifest.name);
          packageRegistry.register(manifest);
          if (existing) result.updated++; else result.registered++;
        } catch (err) {
          result.errors.push({
            path:  manifest.name,
            error: (err as Error).message,
          });
        }
      }
    }

    return result;
  }

  // ── Load single package by path ───────────────────────────
  loadFromPath(packageDir: string): PackageManifest | null {
    const manifest = extractManifest(packageDir);
    if (!manifest) return null;
    packageRegistry.register(manifest);
    return manifest;
  }
}

export const packageLoader = new PackageLoader();
