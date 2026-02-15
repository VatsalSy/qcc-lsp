import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { URI } from 'vscode-uri';
import { defaultSettings, runDiagnostics } from '../src/diagnostics';

describe('runDiagnostics qcc argv', () => {
  const runIfPosix = process.platform === 'win32' ? test.skip : test;

  runIfPosix('emits include dirs as single -I tokens and includes detected src-local', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qcc-lsp-args-'));
    const repoRoot = path.join(tempRoot, 'repo with spaces');
    const simDir = path.join(repoRoot, 'simulationCases');
    const srcLocalDir = path.join(repoRoot, 'src-local');
    const filePath = path.join(simDir, 'case.c');
    const qccScriptPath = path.join(tempRoot, 'fake-qcc.sh');
    const argsOutputPath = path.join(tempRoot, 'qcc-argv.txt');
    const previousArgsFile = process.env.QCC_LSP_ARGS_FILE;

    try {
      fs.mkdirSync(path.join(repoRoot, '.git'), { recursive: true });
      fs.mkdirSync(simDir, { recursive: true });
      fs.mkdirSync(srcLocalDir, { recursive: true });
      fs.writeFileSync(filePath, 'int main(void) { return 0; }\n', 'utf8');

      fs.writeFileSync(
        qccScriptPath,
        '#!/bin/sh\nset -eu\n: > "$QCC_LSP_ARGS_FILE"\nfor arg in "$@"; do\n  printf \'%s\\n\' "$arg" >> "$QCC_LSP_ARGS_FILE"\ndone\nexit 0\n',
        'utf8'
      );
      fs.chmodSync(qccScriptPath, 0o755);
      process.env.QCC_LSP_ARGS_FILE = argsOutputPath;

      const settings = {
        ...defaultSettings,
        qccPath: qccScriptPath,
        qcc: {
          includePaths: []
        }
      };

      const diagnostics = await runDiagnostics(
        URI.file(filePath).toString(),
        'int main(void) { return 0; }\n',
        settings
      );

      expect(diagnostics).toHaveLength(0);

      const argv = fs.readFileSync(argsOutputPath, 'utf8').split(/\r?\n/).filter((entry) => entry.length > 0);

      expect(argv).toEqual(expect.arrayContaining([`-I${simDir}`, `-I${srcLocalDir}`]));
      expect(argv).not.toContain('-I');
    } finally {
      if (previousArgsFile === undefined) {
        delete process.env.QCC_LSP_ARGS_FILE;
      } else {
        process.env.QCC_LSP_ARGS_FILE = previousArgsFile;
      }
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
