import * as os from 'os';
import * as path from 'path';
import { BasiliskSettings } from './diagnostics';
import { resolveExecutableOnPath } from './pathUtils';

/**
 * Resolves a path setting with tilde expansion and workspace root resolution.
 *
 * Expands ~ to home directory, resolves relative paths against rootPath,
 * and returns absolute paths unchanged.
 *
 * @param value - Path string from settings
 * @param rootPath - Workspace root path for relative resolution, or null
 * @returns Resolved absolute path, or empty string if value is empty
 */
export function resolvePathSetting(value: string, rootPath: string | null): string {
  if (!value) {
    return '';
  }

  const expanded = value.startsWith('~')
    ? path.join(os.homedir(), value.slice(1))
    : value;

  if (path.isAbsolute(expanded)) {
    return expanded;
  }

  return rootPath ? path.join(rootPath, expanded) : expanded;
}

/**
 * Resolves the Basilisk installation root directory.
 *
 * Checks in order: settings.basiliskPath, BASILISK env var, qcc location.
 *
 * @param settings - Current Basilisk settings
 * @param rootPath - Workspace root path for relative resolution
 * @returns Basilisk root path if found, null otherwise
 */
export function resolveBasiliskRoot(settings: BasiliskSettings, rootPath: string | null): string | null {
  if (settings.basiliskPath) {
    return resolvePathSetting(settings.basiliskPath, rootPath);
  }

  const envPath = process.env.BASILISK;
  if (envPath) {
    return resolvePathSetting(envPath, rootPath);
  }

  const qccResolved = resolveExecutableOnPath(settings.qccPath) || resolveExecutableOnPath('qcc');
  if (qccResolved) {
    return path.dirname(qccResolved);
  }

  return null;
}

/**
 * Derives default clangd fallback include flags from Basilisk root.
 *
 * Returns include flags for Basilisk core directories (root, grid, navier-stokes, ast).
 *
 * @param basiliskRoot - Basilisk installation root path
 * @returns Array of -I flags, or empty array if basiliskRoot is null
 */
export function deriveBasiliskFallbackFlags(basiliskRoot: string | null): string[] {
  if (!basiliskRoot) {
    return [];
  }
  return [
    `-I${basiliskRoot}`,
    `-I${path.join(basiliskRoot, 'grid')}`,
    `-I${path.join(basiliskRoot, 'navier-stokes')}`,
    `-I${path.join(basiliskRoot, 'ast')}`
  ];
}

/**
 * Merges two arrays of compiler flags, deduplicating entries.
 *
 * @param primary - First array of flags
 * @param secondary - Second array of flags to merge
 * @returns Merged array with duplicates removed
 */
export function mergeFlags(primary: string[], secondary: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const flag of [...primary, ...secondary]) {
    if (seen.has(flag)) {
      continue;
    }
    seen.add(flag);
    merged.push(flag);
  }
  return merged;
}
