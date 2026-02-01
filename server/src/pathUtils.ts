import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function expandTilde(value: string): string {
  if (value.startsWith('~')) {
    return path.join(os.homedir(), value.slice(1));
  }
  return value;
}

export function resolveExecutableOnPath(command: string): string | null {
  if (!command) {
    return null;
  }

  const expanded = expandTilde(command);
  if (path.isAbsolute(expanded)) {
    return fs.existsSync(expanded) ? expanded : null;
  }

  const pathEnv = process.env.PATH || '';
  const pathDirs = pathEnv.split(path.delimiter).filter(Boolean);
  const isWindows = process.platform === 'win32';
  const hasExt = path.extname(expanded).length > 0;
  const extensions = isWindows
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';')
    : [''];

  for (const dir of pathDirs) {
    for (const ext of extensions) {
      const candidate = hasExt ? expanded : `${expanded}${ext}`;
      const fullPath = path.join(dir, candidate);
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    }
  }

  return null;
}
