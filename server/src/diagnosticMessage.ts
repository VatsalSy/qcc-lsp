import type { Diagnostic } from 'vscode-languageserver/node';

export function diagnosticMessageText(message: Diagnostic['message']): string {
  return typeof message === 'string' ? message : message.value;
}
