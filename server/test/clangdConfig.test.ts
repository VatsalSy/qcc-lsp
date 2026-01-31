import * as os from 'os';
import * as path from 'path';
import { deriveBasiliskFallbackFlags, mergeFlags, resolvePathSetting } from '../src/clangdConfig';

describe('clangdConfig', () => {
  test('resolvePathSetting handles relative paths', () => {
    const root = path.join(os.tmpdir(), 'basilisk-root');
    expect(resolvePathSetting('include', root)).toBe(path.join(root, 'include'));
  });

  test('resolvePathSetting expands home paths', () => {
    const resolved = resolvePathSetting('~/basilisk', null);
    expect(resolved.startsWith(os.homedir())).toBe(true);
  });

  test('deriveBasiliskFallbackFlags builds include list', () => {
    const root = '/tmp/basilisk';
    const flags = deriveBasiliskFallbackFlags(root);
    expect(flags).toEqual([
      `-I${root}`,
      `-I${path.join(root, 'grid')}`,
      `-I${path.join(root, 'navier-stokes')}`,
      `-I${path.join(root, 'ast')}`
    ]);
  });

  test('mergeFlags preserves order and de-dupes', () => {
    const merged = mergeFlags(['-I/a', '-I/b'], ['-I/b', '-I/c']);
    expect(merged).toEqual(['-I/a', '-I/b', '-I/c']);
  });
});
