import { projectConfigToSettings } from '../src/projectConfig';

describe('project configuration execution boundary', () => {
  it('preserves documented data settings but discards tool and argument overrides', () => {
    expect(projectConfigToSettings({
      qccPath: 'project-tools/qcc',
      basiliskPath: 'project-tools',
      qcc: { includePaths: ['includes'] },
      clangd: {
        path: 'project-tools/clangd',
        args: ['--fixture-argument'],
        compileCommandsDir: 'build',
        fallbackFlags: ['-Iheaders'],
        enabled: true,
        mode: 'proxy',
        diagnosticsMode: 'filtered'
      }
    })).toEqual({
      qcc: { includePaths: ['includes'] },
      clangd: { enabled: true, mode: 'proxy', diagnosticsMode: 'filtered' }
    });
  });
});
