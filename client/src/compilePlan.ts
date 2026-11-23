import * as fs from 'fs';
import * as path from 'path';

export function resolveCompiler(setting: string): string | undefined {
  if (!setting || /[\u0000-\u001f\u007f]/.test(setting)) {
    return undefined;
  }
  if (!path.isAbsolute(setting) && path.basename(setting) !== setting) {
    return undefined;
  }

  const names = process.platform === 'win32' && !path.extname(setting)
    ? [setting + '.exe']
    : [setting];
  const directories = (process.env.PATH ?? '').split(path.delimiter).filter(dir => path.isAbsolute(dir));
  const candidates = path.isAbsolute(setting)
    ? names
    : directories.flatMap(dir => names.map(name => path.join(dir, name)));
  return candidates.find(candidate => {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
}

export function compilerInvocation(executable: string, sourcePath: string) {
  const ext = path.extname(sourcePath);
  if (!path.isAbsolute(executable) || !path.isAbsolute(sourcePath) || !ext) {
    throw new Error('Expected an absolute compiler path and a source file with an extension.');
  }
  const cwd = path.dirname(sourcePath);
  const outputName = path.basename(sourcePath, ext) + (process.platform === 'win32' ? '.exe' : '');
  const outputPath = path.join(cwd, outputName);
  if (outputPath === sourcePath) {
    throw new Error('Compilation output must not overwrite the source file.');
  }

  return {
    executable,
    cwd,
    outputPath,
    args: ['-Wall', '-O2', sourcePath, '-o', outputPath, '-lm']
  };
}
