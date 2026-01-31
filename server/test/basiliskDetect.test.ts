import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import { filterClangdDiagnostics, isLikelyBasiliskText } from '../src/basiliskDetect';

describe('basiliskDetect', () => {
  test('detects Basilisk text via keywords', () => {
    expect(isLikelyBasiliskText('foreach() {\n}\n')).toBe(true);
  });

  test('filters noisy clangd diagnostics on Basilisk lines', () => {
    const text = 'scalar f[];\n';
    const diagnostics: Diagnostic[] = [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 }
        },
        message: "unknown type name 'scalar'",
        severity: DiagnosticSeverity.Error,
        source: 'clangd'
      }
    ];

    const filtered = filterClangdDiagnostics(diagnostics, text);
    expect(filtered).toHaveLength(0);
  });

  test('keeps diagnostics for non-Basilisk text', () => {
    const text = 'int main() { return 0; }\n';
    const diagnostics: Diagnostic[] = [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 }
        },
        message: "unknown type name 'scalar'",
        severity: DiagnosticSeverity.Error,
        source: 'clangd'
      }
    ];

    const filtered = filterClangdDiagnostics(diagnostics, text);
    expect(filtered).toEqual(diagnostics);
  });
});
