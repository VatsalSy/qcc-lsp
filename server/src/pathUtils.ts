import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Expands tilde (~) prefix to the user's home directory.
 *
 * @param value - Path string that may start with ~
 * @returns Expanded path with home directory, or original value if no tilde
 */
function expandTilde(value: string): string {
  if (value.startsWith('~')) {
    return path.join(os.homedir(), value.slice(1));
  }
  return value;
}

/**
 * Resolves an executable command to its full path by searching PATH.
 *
 * Handles tilde expansion, absolute paths, and PATH lookup with proper
 * executable permission checking on Unix systems. On Windows, respects PATHEXT.
 *
 * @param command - Command name or path to resolve
 * @returns Full path to executable if found, null otherwise
 */
export function resolveExecutableOnPath(command: string): string | null {
  if (!command) {
    return null;
  }

  const isWindows = process.platform === 'win32';
  const expanded = expandTilde(command);
  if (path.isAbsolute(expanded)) {
    if (!fs.existsSync(expanded)) {
      return null;
    }
    if (isWindows) {
      return expanded;
    }
    try {
      fs.accessSync(expanded, fs.constants.X_OK);
      return expanded;
    } catch {
      return null;
    }
  }

  const pathEnv = process.env.PATH || '';
  const pathDirs = pathEnv.split(path.delimiter).filter(Boolean);
  const hasExt = path.extname(expanded).length > 0;
  const extensions = isWindows
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';')
    : [''];

  for (const dir of pathDirs) {
    if (hasExt) {
      const fullPath = path.join(dir, expanded);
      if (fs.existsSync(fullPath)) {
        if (isWindows) {
          return fullPath;
        }
        try {
          fs.accessSync(fullPath, fs.constants.X_OK);
          return fullPath;
        } catch {
          continue;
        }
      }
      continue;
    }

    for (const ext of extensions) {
      const candidate = `${expanded}${ext}`;
      const fullPath = path.join(dir, candidate);
      if (!fs.existsSync(fullPath)) {
        continue;
      }
      if (isWindows) {
        return fullPath;
      }
      try {
        fs.accessSync(fullPath, fs.constants.X_OK);
        return fullPath;
      } catch {
        continue;
      }
    }
  }

  return null;
}
