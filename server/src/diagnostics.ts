/**
 * Diagnostics Provider for Basilisk C
 *
 * This module provides compilation diagnostics by invoking the qcc compiler
 * and parsing its error output. It supports both syntax errors and semantic
 * errors detected by the compiler.
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
  Diagnostic,
  DiagnosticSeverity,
  Range,
  Position
} from 'vscode-languageserver';

export interface DiagnosticsSettings {
  qccPath: string;
  basiliskPath: string;
  enableDiagnostics: boolean;
  maxNumberOfProblems: number;
}

export const defaultSettings: DiagnosticsSettings = {
  qccPath: 'qcc',
  basiliskPath: '',
  enableDiagnostics: true,
  maxNumberOfProblems: 100
};

/**
 * Parse compiler error output to extract diagnostics
 */
interface ParsedDiagnostic {
  file: string;
  line: number;
  column: number;
  severity: 'error' | 'warning' | 'note';
  message: string;
}

/**
 * Parse GCC-style error messages
 * Format: filename:line:column: severity: message
 */
function parseGccOutput(output: string): ParsedDiagnostic[] {
  const diagnostics: ParsedDiagnostic[] = [];
  const lines = output.split('\n');

  // GCC/Clang error format: file:line:col: error/warning: message
  const errorRegex = /^(.+?):(\d+):(\d+):\s*(error|warning|note):\s*(.+)$/;

  // Alternative format: file:line: error/warning: message (no column)
  const errorRegexNoCol = /^(.+?):(\d+):\s*(error|warning|note):\s*(.+)$/;

  // Basilisk/qcc specific format
  const qccErrorRegex = /^(.+?):(\d+):\s*(.+)$/;

  for (const line of lines) {
    let match = errorRegex.exec(line);
    if (match) {
      diagnostics.push({
        file: match[1],
        line: parseInt(match[2], 10),
        column: parseInt(match[3], 10),
        severity: match[4] as 'error' | 'warning' | 'note',
        message: match[5]
      });
      continue;
    }

    match = errorRegexNoCol.exec(line);
    if (match) {
      diagnostics.push({
        file: match[1],
        line: parseInt(match[2], 10),
        column: 1,
        severity: match[3] as 'error' | 'warning' | 'note',
        message: match[4]
      });
      continue;
    }

    match = qccErrorRegex.exec(line);
    if (match && (line.includes('error') || line.includes('undefined') || line.includes('undeclared'))) {
      diagnostics.push({
        file: match[1],
        line: parseInt(match[2], 10),
        column: 1,
        severity: 'error',
        message: match[3]
      });
    }
  }

  return diagnostics;
}

/**
 * Convert severity string to DiagnosticSeverity
 */
function toSeverity(severity: 'error' | 'warning' | 'note'): DiagnosticSeverity {
  switch (severity) {
    case 'error':
      return DiagnosticSeverity.Error;
    case 'warning':
      return DiagnosticSeverity.Warning;
    case 'note':
      return DiagnosticSeverity.Information;
    default:
      return DiagnosticSeverity.Error;
  }
}

/**
 * Create a Diagnostic from parsed error
 */
function createDiagnostic(parsed: ParsedDiagnostic): Diagnostic {
  // Lines and columns are 1-based in compiler output, 0-based in LSP
  const line = Math.max(0, parsed.line - 1);
  const col = Math.max(0, parsed.column - 1);

  return {
    range: Range.create(
      Position.create(line, col),
      Position.create(line, col + 1) // Highlight at least one character
    ),
    severity: toSeverity(parsed.severity),
    source: 'qcc',
    message: parsed.message
  };
}

/**
 * Run qcc to check for syntax errors
 */
export async function runDiagnostics(
  documentUri: string,
  content: string,
  settings: DiagnosticsSettings
): Promise<Diagnostic[]> {
  if (!settings.enableDiagnostics) {
    return [];
  }

  const diagnostics: Diagnostic[] = [];
  let tempFile: string | null = null;

  try {
    // Create a temporary file with the content
    const tempDir = os.tmpdir();
    const fileName = path.basename(documentUri);
    tempFile = path.join(tempDir, `basilisk_${Date.now()}_${fileName}`);

    // Ensure the temp file has .c extension for qcc
    if (!tempFile.endsWith('.c')) {
      tempFile += '.c';
    }

    fs.writeFileSync(tempFile, content);

    // Build qcc command
    const args: string[] = [
      '-Wall',           // Enable all warnings
      '-fsyntax-only',   // Only check syntax, don't compile
      tempFile
    ];

    // Set up environment
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (settings.basiliskPath) {
      env['BASILISK'] = settings.basiliskPath;
    }

    // Run qcc
    const result = await runCommand(settings.qccPath, args, {
      env,
      cwd: path.dirname(documentUri.replace('file://', ''))
    });

    // Parse output
    const allOutput = result.stderr + result.stdout;
    const parsedDiagnostics = parseGccOutput(allOutput);

    // Filter diagnostics to only include those for our file
    const baseFileName = path.basename(tempFile);
    for (const parsed of parsedDiagnostics) {
      // Match if the file is our temp file or the original file
      const parsedBase = path.basename(parsed.file);
      if (parsedBase === baseFileName ||
          parsedBase === path.basename(documentUri) ||
          parsed.file.includes(baseFileName)) {
        const diagnostic = createDiagnostic(parsed);
        diagnostics.push(diagnostic);

        if (diagnostics.length >= settings.maxNumberOfProblems) {
          break;
        }
      }
    }
  } catch (error) {
    // If qcc is not found or fails, add a diagnostic
    const err = error as Error;
    if (err.message.includes('ENOENT') || err.message.includes('not found')) {
      diagnostics.push({
        range: Range.create(Position.create(0, 0), Position.create(0, 1)),
        severity: DiagnosticSeverity.Warning,
        source: 'basilisk-lsp',
        message: `qcc compiler not found at '${settings.qccPath}'. Set basilisk.qccPath in settings.`
      });
    }
  } finally {
    // Clean up temp file
    if (tempFile && fs.existsSync(tempFile)) {
      try {
        fs.unlinkSync(tempFile);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  return diagnostics;
}

/**
 * Run a command and capture output
 */
interface CommandResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

function runCommand(
  command: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; cwd?: string; timeout?: number }
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const timeout = options.timeout || 30000; // 30 second default timeout

    let process: ChildProcess;
    try {
      process = spawn(command, args, {
        env: options.env,
        cwd: options.cwd,
        shell: true
      });
    } catch (error) {
      reject(error);
      return;
    }

    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      process.kill();
      reject(new Error(`Command timed out after ${timeout}ms`));
    }, timeout);

    process.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    process.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    process.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    process.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
  });
}

/**
 * Quick syntax validation without running compiler
 * Checks for common Basilisk syntax issues
 */
export function quickValidate(content: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for unclosed foreach without braces on same line
    if (/^\s*foreach\s*\([^)]*\)\s*$/.test(line)) {
      // Look ahead to see if next non-empty line has a brace
      let foundBrace = false;
      for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
        if (lines[j].trim().startsWith('{') || lines[j].trim() === '') {
          foundBrace = true;
          break;
        }
        if (lines[j].trim().length > 0) {
          break;
        }
      }
      if (!foundBrace && i + 1 < lines.length && !lines[i + 1].trim().startsWith('{')) {
        // Check if it's a single-line statement
        const nextLine = lines[i + 1]?.trim() || '';
        if (nextLine && !nextLine.endsWith(';') && !nextLine.startsWith('{')) {
          diagnostics.push({
            range: Range.create(Position.create(i, 0), Position.create(i, line.length)),
            severity: DiagnosticSeverity.Hint,
            source: 'basilisk-lsp',
            message: 'Consider using braces {} for foreach loops for clarity'
          });
        }
      }
    }

    // Check for common mistakes with field access
    // Accessing field without [] in foreach context
    const fieldAccessRegex = /\b(scalar|vector)\s+(\w+)\s*;/;
    const match = fieldAccessRegex.exec(line);
    if (match) {
      diagnostics.push({
        range: Range.create(Position.create(i, match.index), Position.create(i, match.index + match[0].length)),
        severity: DiagnosticSeverity.Warning,
        source: 'basilisk-lsp',
        message: `Field '${match[2]}' should be declared with [], e.g., '${match[1]} ${match[2]}[]'`
      });
    }

    // Check for event without parentheses
    if (/^\s*event\s+\w+\s+[^(]/.test(line) && !/^\s*event\s+\w+\s*\(/.test(line)) {
      diagnostics.push({
        range: Range.create(Position.create(i, 0), Position.create(i, line.length)),
        severity: DiagnosticSeverity.Error,
        source: 'basilisk-lsp',
        message: 'Event definition requires parentheses with timing parameters'
      });
    }

    // Check for reduction outside foreach
    if (/reduction\s*\(/.test(line) && !/foreach/.test(line)) {
      // Look back for foreach
      let inForeach = false;
      for (let j = i - 1; j >= Math.max(0, i - 20); j--) {
        if (/foreach/.test(lines[j])) {
          // Check if we've passed the closing brace
          let braceCount = 0;
          for (let k = j; k <= i; k++) {
            braceCount += (lines[k].match(/{/g) || []).length;
            braceCount -= (lines[k].match(/}/g) || []).length;
          }
          if (braceCount > 0) {
            inForeach = true;
          }
          break;
        }
      }
      // Actually reduction should be in foreach parameters, not body
      // This is a more nuanced check
    }
  }

  return diagnostics;
}

/**
 * Check if qcc is available
 */
export async function checkQccAvailable(qccPath: string): Promise<boolean> {
  try {
    const result = await runCommand(qccPath, ['--version'], { timeout: 5000 });
    return result.code === 0 || result.stdout.includes('gcc') || result.stderr.includes('gcc');
  } catch {
    return false;
  }
}

/**
 * Get qcc version information
 */
export async function getQccVersion(qccPath: string): Promise<string | null> {
  try {
    const result = await runCommand(qccPath, ['--version'], { timeout: 5000 });
    const output = result.stdout || result.stderr;
    // First line typically contains version info
    const firstLine = output.split('\n')[0];
    return firstLine || null;
  } catch {
    return null;
  }
}
