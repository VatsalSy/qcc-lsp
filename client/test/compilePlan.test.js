const path = require('node:path');
const { compilerInvocation, resolveCompiler } = require('../out/compilePlan');

describe('Basilisk compiler invocation', () => {
  it('keeps paths with spaces in individual arguments', () => {
    const directory = path.resolve('Basilisk examples');
    const source = path.join(directory, 'thin sheet.c');
    const compiler = path.resolve('tool directory', 'qcc');
    const plan = compilerInvocation(compiler, source);

    expect(plan.executable).toBe(compiler);
    expect(plan.cwd).toBe(directory);
    expect(plan.outputPath).toBe(path.join(directory, process.platform === 'win32' ? 'thin sheet.exe' : 'thin sheet'));
    expect(plan.args).toEqual(['-Wall', '-O2', source, '-o', plan.outputPath, '-lm']);
  });

  it('does not resolve workspace-relative executable settings', () => {
    expect(resolveCompiler(path.join('tools', 'qcc'))).toBeUndefined();
  });
});
