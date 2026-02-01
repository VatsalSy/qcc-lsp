import * as os from 'os';
import * as path from 'path';
import { BasiliskSettings } from './diagnostics';
import { resolveExecutableOnPath } from './pathUtils';

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
