/**
 * @ralph/package-orchestrator — Core Types
 */

// ─── PACKAGE ──────────────────────────────────────────────────────────────────

export type PackageType = 'frontend' | 'api' | 'service' | 'hybrid';
export type PackageStatus = 'active' | 'inactive' | 'error';

export interface RalphPackage {
  /** Unique identifier — matches package.json name, e.g. 'ralph-analytics-core' */
  name:        string;
  /** Semver string from package.json */
  version:     string;
  /** Human-readable description */
  description: string;
  /** URL path this package mounts at, e.g. '/analytics' */
  route:       string;
  /** Absolute path to entrypoint on disk */
  entry:       string;
  /** Package capability type */
  type:        PackageType;
  /** Icon identifier (optional, used by portals) */
  icon?:       string;
  /** Display label override (optional) */
  label?:      string;
  /** Tags for filtering, e.g. ['reporting', 'compliance'] */
  tags?:       string[];
  /** Whether this package requires a paid tier */
  tier?:       'free' | 'professional' | 'enterprise';
  /** System status */
  status:      PackageStatus;
  /** ISO timestamp of last registration */
  registeredAt: string;
  /** ISO timestamp of last update */
  updatedAt:    string;
}

/** Exported from each individual Ralph package */
export interface PackageManifest {
  name:        string;
  version?:    string;
  description?: string;
  route:       string;
  type?:       PackageType;
  icon?:       string;
  label?:      string;
  tags?:       string[];
  tier?:       'free' | 'professional' | 'enterprise';
}

// ─── CLIENT ───────────────────────────────────────────────────────────────────

export interface Client {
  /** CUID */
  id:         string;
  /** Company / organisation name */
  name:       string;
  /** URL slug, e.g. 'acme-corp' */
  slug:       string;
  /** Custom domain if any, e.g. 'portal.acme.com' */
  domain?:    string;
  /** Primary contact email */
  email?:     string;
  /** Subscription tier */
  tier:       'free' | 'professional' | 'enterprise';
  /** Whether the client account is active */
  active:     boolean;
  /** ISO timestamp */
  createdAt:  string;
  updatedAt:  string;
}

// ─── ASSIGNMENT ───────────────────────────────────────────────────────────────

export interface ClientPackageAssignment {
  id:          string;
  clientId:    string;
  packageName: string;
  /** Whether this specific assignment is currently enabled */
  enabled:     boolean;
  /** Optional per-client config JSON blob */
  config?:     Record<string, unknown>;
  /** Who assigned it */
  assignedBy?: string;
  assignedAt:  string;
  updatedAt:   string;
}

// ─── API RESPONSES ────────────────────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?:   T;
  error?:  string;
  meta?: {
    total?:   number;
    page?:    number;
    perPage?: number;
  };
}

export interface PackageWithAssignment extends RalphPackage {
  assignment?: ClientPackageAssignment;
}
