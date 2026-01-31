import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface ProjectConfig {
  basiliskPath?: string;
  qccPath?: string;
  qcc?: {
    includePaths?: string[];
  };
  qccIncludePaths?: string[];
  clangd?: {
    enabled?: boolean;
    mode?: 'proxy' | 'augment' | 'disabled';
    path?: string;
    args?: string[];
    compileCommandsDir?: string;
    fallbackFlags?: string[];
    diagnosticsMode?: 'all' | 'filtered' | 'none';
  };
}

export interface ProjectConfigResult {
  path: string | null;
  config: ProjectConfig | null;
  error?: string;
}

function expandHome(value: string): string {
  if (!value.startsWith('~')) {
    return value;
  }
  return path.join(os.homedir(), value.slice(1));
}

function resolvePathEntry(value: string, baseDir: string): string {
  const expanded = expandHome(value);
  if (path.isAbsolute(expanded)) {
    return expanded;
  }
  return path.join(baseDir, expanded);
}

function resolvePathArray(values: string[] | undefined, baseDir: string): string[] {
  if (!values || values.length === 0) {
    return [];
  }
  return values.map((entry) => resolvePathEntry(entry, baseDir));
}

function resolveConfigPath(inputPath: string): string {
  const expanded = expandHome(inputPath);
  if (path.isAbsolute(expanded)) {
    return expanded;
  }
  return path.resolve(process.cwd(), expanded);
}

function isDirectory(dirPath: string): boolean {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

export function findRepoRoot(startDir: string): string | null {
  let current = startDir;
  while (true) {
    const gitPath = path.join(current, '.git');
    if (fs.existsSync(gitPath)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return null;
}

export function findSrcLocalDir(startDir: string): string | null {
  const repoRoot = findRepoRoot(startDir);
  let current = startDir;
  while (true) {
    const candidate = path.join(current, 'src-local');
    if (isDirectory(candidate)) {
      return candidate;
    }
    if (repoRoot && current === repoRoot) {
      break;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return null;
}

function findConfigPath(startDir: string, fileName: string): string | null {
  const repoRoot = findRepoRoot(startDir);
  let current = startDir;
  while (true) {
    const candidate = path.join(current, fileName);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    if (repoRoot && current === repoRoot) {
      break;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return null;
}

export function loadProjectConfig(startDir: string, fileName = '.comphy-basilisk'): ProjectConfigResult {
  const configPath = findConfigPath(startDir, fileName);
  if (!configPath) {
    return { path: null, config: null };
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf8').trim();
    if (!raw) {
      return { path: configPath, config: null };
    }
    const parsed = JSON.parse(raw) as ProjectConfig;
    const baseDir = path.dirname(configPath);
    const resolved = resolveProjectConfig(parsed, baseDir);
    return { path: configPath, config: resolved };
  } catch (error) {
    return {
      path: configPath,
      config: null,
      error: (error as Error).message
    };
  }
}

export function loadProjectConfigFromFile(filePath: string): ProjectConfigResult {
  const resolvedPath = resolveConfigPath(filePath);
  if (!fs.existsSync(resolvedPath)) {
    return {
      path: resolvedPath,
      config: null,
      error: 'file not found'
    };
  }

  try {
    const raw = fs.readFileSync(resolvedPath, 'utf8').trim();
    if (!raw) {
      return { path: resolvedPath, config: null };
    }
    const parsed = JSON.parse(raw) as ProjectConfig;
    const baseDir = path.dirname(resolvedPath);
    const resolved = resolveProjectConfig(parsed, baseDir);
    return { path: resolvedPath, config: resolved };
  } catch (error) {
    return {
      path: resolvedPath,
      config: null,
      error: (error as Error).message
    };
  }
}

export function resolveProjectConfig(config: ProjectConfig, baseDir: string): ProjectConfig {
  const resolved: ProjectConfig = { ...config };

  if (config.basiliskPath) {
    resolved.basiliskPath = resolvePathEntry(config.basiliskPath, baseDir);
  }
  if (config.qccPath) {
    resolved.qccPath = resolvePathEntry(config.qccPath, baseDir);
  }

  const includePaths = [
    ...(config.qcc?.includePaths ?? []),
    ...(config.qccIncludePaths ?? [])
  ];
  if (includePaths.length > 0) {
    resolved.qcc = {
      ...(config.qcc || {}),
      includePaths: resolvePathArray(includePaths, baseDir)
    };
  }

  if (config.clangd) {
    resolved.clangd = { ...config.clangd };
    if (config.clangd.compileCommandsDir) {
      resolved.clangd.compileCommandsDir = resolvePathEntry(
        config.clangd.compileCommandsDir,
        baseDir
      );
    }
  }

  return resolved;
}
