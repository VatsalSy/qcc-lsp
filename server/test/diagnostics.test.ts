import { DiagnosticSeverity } from 'vscode-languageserver';
import { quickValidate } from '../src/diagnostics';
import { diagnosticMessageText } from '../src/diagnosticMessage';

describe('diagnostics', () => {
  test('quickValidate flags scalar declarations without []', () => {
    const diagnostics = quickValidate('scalar f;\n');
    const messages = diagnostics.map((diag) => diagnosticMessageText(diag.message));
    expect(messages.some((message) => message.includes("Field 'f'"))).toBe(true);
  });

  test('quickValidate flags event definitions without parentheses', () => {
    const diagnostics = quickValidate('event init t = 0;\n');
    const hasEventError = diagnostics.some(
      (diag) => diag.severity === DiagnosticSeverity.Error && diagnosticMessageText(diag.message).includes('Event definition')
    );
    expect(hasEventError).toBe(true);
  });
});
