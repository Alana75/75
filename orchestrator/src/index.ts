/**
 * @ralph/package-orchestrator — Public API
 * Import this from other packages to interact with the registry.
 */

// Core registries
export { packageRegistry }  from './registry/PackageRegistry.js';
export { clientRegistry }   from './clients/ClientRegistry.js';
export { assignmentManager } from './assignments/AssignmentManager.js';
export { packageLoader }    from './loader/PackageLoader.js';

// Types
export type {
  RalphPackage,
  PackageManifest,
  PackageType,
  PackageStatus,
  Client,
  ClientPackageAssignment,
  PackageWithAssignment,
  ApiResponse,
} from './types/index.js';

// Express router (for embedding into existing Express apps)
export { apiRouter } from './api/router.js';
