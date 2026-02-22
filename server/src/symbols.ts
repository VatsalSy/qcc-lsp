/**
 * Document Symbol Provider for Basilisk C
 *
 * Extracts symbols (functions, events, fields, variables) from Basilisk C
 * source files for navigation and workspace symbol search.
 */

import {
  DocumentSymbol,
  SymbolKind,
  Range,
  Position,
  Location
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { FIELD_TYPES, BUILTIN_FUNCTIONS, CONTROL_KEYWORDS } from './basiliskLanguage';

/**
 * Symbol information stored in the index
 */
export interface BasiliskSymbol {
  name: string;
  kind: SymbolKind;
  location: Location;
  detail?: string;
  documentation?: string;
  children?: BasiliskSymbol[];
  containerName?: string;
}

/**
 * Document symbol index
 */
export class SymbolIndex {
  private symbols: Map<string, BasiliskSymbol[]> = new Map();
  private documentSymbols: Map<string, DocumentSymbol[]> = new Map();

  /**
   * Index a document
   */
  indexDocument(document: TextDocument): DocumentSymbol[] {
    const uri = document.uri;
    const symbols = extractSymbols(document);

    this.documentSymbols.set(uri, symbols);

    // Flatten for workspace search
    const flatSymbols = flattenSymbols(symbols, uri);
    this.symbols.set(uri, flatSymbols);

    return symbols;
  }

  /**
   * Get symbols for a document
   */
  getDocumentSymbols(uri: string): DocumentSymbol[] {
    return this.documentSymbols.get(uri) || [];
  }

  /**
   * Search for symbols across workspace
   */
  findSymbols(query: string): BasiliskSymbol[] {
    const results: BasiliskSymbol[] = [];
    const lowerQuery = query.toLowerCase();

    for (const symbols of this.symbols.values()) {
      for (const symbol of symbols) {
        if (symbol.name.toLowerCase().includes(lowerQuery)) {
          results.push(symbol);
        }
      }
    }

    return results;
  }

  /**
   * Find symbol definition by name
   */
  findDefinition(name: string): BasiliskSymbol | undefined {
    for (const symbols of this.symbols.values()) {
      for (const symbol of symbols) {
        if (symbol.name === name) {
          return symbol;
        }
      }
    }
    return undefined;
  }

  /**
   * Remove document from index
   */
  removeDocument(uri: string): void {
    this.symbols.delete(uri);
    this.documentSymbols.delete(uri);
  }

  /**
   * Clear the entire index
   */
  clear(): void {
    this.symbols.clear();
    this.documentSymbols.clear();
  }
}

/**
 * Extract symbols from a document
 */
function extractSymbols(document: TextDocument): DocumentSymbol[] {
  const symbols: DocumentSymbol[] = [];
  const text = document.getText();
  const lines = text.split('\n');

  // Track brace depth for scope
  let braceDepth = 0;
  let currentContainer: DocumentSymbol | null = null;

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];

    // Update brace depth, ignoring braces inside strings and comments
    let inString = false;
    let inChar = false;
    let inLineComment = false;
    let inBlockComment = false;
    let escaped = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = i + 1 < line.length ? line[i + 1] : '';

      // Handle escape sequences in strings
      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === '\\' && (inString || inChar)) {
        escaped = true;
        continue;
      }

      // Check for comment start
      if (!inString && !inChar && !inLineComment && !inBlockComment) {
        if (char === '/' && nextChar === '/') {
          inLineComment = true;
          i++; // skip next char
          continue;
        }
        if (char === '/' && nextChar === '*') {
          inBlockComment = true;
          i++; // skip next char
          continue;
        }
      }

      // Check for block comment end
      if (inBlockComment && char === '*' && nextChar === '/') {
        inBlockComment = false;
        i++; // skip next char
        continue;
      }

      // Skip if in any comment
      if (inLineComment || inBlockComment) {
        continue;
      }

      // Handle string delimiters
      if (char === '"' && !inChar) {
        inString = !inString;
        continue;
      }

      // Handle char delimiters
      if (char === "'" && !inString) {
        inChar = !inChar;
        continue;
      }

      // Only count braces outside strings and comments
      if (!inString && !inChar) {
        if (char === '{') {
          braceDepth++;
        }
        if (char === '}') {
          braceDepth--;
          if (braceDepth === 0) {
            currentContainer = null;
          }
        }
      }
    }

    // Extract events
    const eventMatch = /^\s*event\s+(\w+)\s*\(([^)]*)\)\s*\{?/.exec(line);
    if (eventMatch) {
      const documentation = extractDocComment(lines, lineNum);
      const symbol = createSymbol(
        eventMatch[1],
        SymbolKind.Event,
        `event (${eventMatch[2].trim()})`,
        lineNum,
        eventMatch.index,
        line.length,
        documentation
      );
      symbols.push(symbol);
      currentContainer = symbol;
      continue;
    }

    // Extract function definitions
    const funcMatch = /^(?:static\s+)?(?:inline\s+)?(\w+(?:\s*\*)?)\s+(\w+)\s*\(([^)]*)\)\s*\{?$/.exec(line);
    if (funcMatch && !isKeyword(funcMatch[2])) {
      const returnType = funcMatch[1];
      const funcName = funcMatch[2];
      const params = funcMatch[3];

      // Skip if it looks like a foreach or control statement
      if (!CONTROL_KEYWORDS.includes(funcName as typeof CONTROL_KEYWORDS[number])) {
        const documentation = extractDocComment(lines, lineNum);
        const symbol = createSymbol(
          funcName,
          SymbolKind.Function,
          `${returnType} ${funcName}(${params.trim()})`,
          lineNum,
          0,
          line.length,
          documentation
        );
        symbols.push(symbol);
        currentContainer = symbol;
      }
      continue;
    }

    // Extract field declarations (scalar, vector, tensor, etc.)
    const fieldMatch = /^\s*(face\s+vector|vertex\s+scalar|vertex\s+vector|scalar|vector|tensor|symmetric\s+tensor)\s+([^;]+);/.exec(line);
    if (fieldMatch) {
      const fieldType = fieldMatch[1];
      const declarations = fieldMatch[2];
      const documentation = extractDocComment(lines, lineNum);

      // Parse multiple declarations: "scalar f[], g[], h[]"
      const fieldNames = declarations.split(',').map(d => d.trim());
      for (const decl of fieldNames) {
        // Extract name from "f[]" or "f[param]"
        const nameMatch = /(\w+)\s*\[/.exec(decl);
        if (nameMatch) {
          const name = nameMatch[1];
          const symbol = createSymbol(
            name,
            SymbolKind.Field,
            fieldType,
            lineNum,
            line.indexOf(name),
            line.length,
            documentation
          );

          if (currentContainer && currentContainer.children) {
            currentContainer.children.push(symbol);
          } else if (currentContainer) {
            currentContainer.children = [symbol];
          } else {
            symbols.push(symbol);
          }
        }
      }
      continue;
    }

    // Extract global variable declarations
    const globalMatch = /^(?:static\s+)?(?:const\s+)?(double|int|float|char|long|short|unsigned|size_t)\s+(\w+)\s*(?:=|;)/.exec(line);
    if (globalMatch && braceDepth === 0) {
      const varType = globalMatch[1];
      const varName = globalMatch[2];

      // Skip common false positives
      if (!isBuiltinOrKeyword(varName)) {
        const documentation = extractDocComment(lines, lineNum);
        const symbol = createSymbol(
          varName,
          SymbolKind.Variable,
          varType,
          lineNum,
          line.indexOf(varName),
          line.length,
          documentation
        );
        symbols.push(symbol);
      }
      continue;
    }

    // Extract struct/typedef definitions
    const structMatch = /^\s*typedef\s+struct\s*(?:\w*)\s*\{/.exec(line);
    if (structMatch) {
      const documentation = extractDocComment(lines, lineNum);
      // Look for the closing brace and name
      let depth = 1;
      for (let j = lineNum + 1; j < lines.length && depth > 0; j++) {
        for (const char of lines[j]) {
          if (char === '{') depth++;
          if (char === '}') depth--;
        }
        if (depth === 0) {
          const closingLine = j;
          const closingMatch = /}\s*(\w+)\s*;/.exec(lines[j]);
          if (closingMatch) {
            const symbol = createSymbol(
              closingMatch[1],
              SymbolKind.Struct,
              'typedef struct',
              lineNum,
              0,
              line.length,
              documentation
            );
            // Set range to include entire struct
            symbol.range = Range.create(
              Position.create(lineNum, 0),
              Position.create(closingLine, lines[closingLine].length)
            );
            symbols.push(symbol);
          }
          break;
        }
      }
      continue;
    }

    // Extract #define macros
    const defineMatch = /^\s*#define\s+(\w+)(?:\(([^)]*)\))?\s+(.*)/.exec(line);
    if (defineMatch) {
      const macroName = defineMatch[1];
      const params = defineMatch[2];

      const detail = params ? `#define ${macroName}(${params})` : `#define ${macroName}`;
      const documentation = extractDocComment(lines, lineNum);
      const symbol = createSymbol(
        macroName,
        params ? SymbolKind.Function : SymbolKind.Constant,
        detail,
        lineNum,
        line.indexOf(macroName),
        line.length,
        documentation
      );
      symbols.push(symbol);
      continue;
    }

    // Extract enum definitions
    const enumMatch = /^\s*(?:typedef\s+)?enum\s*(\w*)\s*\{/.exec(line);
    if (enumMatch) {
      const enumName = enumMatch[1] || 'anonymous';
      const documentation = extractDocComment(lines, lineNum);
      const symbol = createSymbol(
        enumName,
        SymbolKind.Enum,
        'enum',
        lineNum,
        0,
        line.length,
        documentation
      );
      symbols.push(symbol);
      continue;
    }
  }

  return symbols;
}

/**
 * Create a DocumentSymbol
 */
function createSymbol(
  name: string,
  kind: SymbolKind,
  detail: string,
  line: number,
  startCol: number,
  length: number,
  documentation?: string
): DocumentSymbol & { documentation?: string } {
  const safeStart = Math.max(0, startCol);
  const selectionEnd = safeStart + name.length;
  const rangeEnd = Math.max(length, selectionEnd);
  const range = Range.create(
    Position.create(line, 0),
    Position.create(line, rangeEnd)
  );
  const selectionRange = Range.create(
    Position.create(line, safeStart),
    Position.create(line, selectionEnd)
  );

  return {
    name,
    kind,
    detail,
    range,
    selectionRange,
    children: [],
    documentation
  };
}

/**
 * Flatten nested symbols for workspace search
 */
function flattenSymbols(symbols: DocumentSymbol[], uri: string, containerName?: string): BasiliskSymbol[] {
  const result: BasiliskSymbol[] = [];

  for (const symbol of symbols) {
    const documentation = (symbol as DocumentSymbol & { documentation?: string }).documentation;
    result.push({
      name: symbol.name,
      kind: symbol.kind,
      detail: symbol.detail,
      documentation,
      containerName,
      location: {
        uri,
        range: symbol.selectionRange
      }
    });

    if (symbol.children && symbol.children.length > 0) {
      result.push(...flattenSymbols(symbol.children, uri, symbol.name));
    }
  }

  return result;
}

function extractDocComment(lines: string[], lineNum: number): string | undefined {
  let i = lineNum - 1;
  while (i >= 0 && lines[i].trim() === '') {
    i--;
  }
  if (i < 0) {
    return undefined;
  }

  if (!lines[i].includes('*/')) {
    return undefined;
  }

  let start = i;
  while (start >= 0) {
    const line = lines[start];
    if (line.includes('/**') || line.includes('/*!')) {
      break;
    }
    if (line.includes('/*')) {
      return undefined;
    }
    start--;
  }

  if (start < 0) {
    return undefined;
  }

  const raw = lines.slice(start, i + 1);
  const cleaned = raw.map((line, index) => {
    let value = line;
    if (index === 0) {
      value = value.replace(/^\s*\/\*+!?/, '');
    }
    if (index === raw.length - 1) {
      value = value.replace(/\*\/\s*$/, '');
    }
    value = value.replace(/^\s*\*\s?/, '');
    return value;
  });

  const doc = cleaned.join('\n').trim();
  return doc.length > 0 ? doc : undefined;
}

/**
 * Check if a word is a keyword
 */
function isKeyword(word: string): boolean {
  const cKeywords = [
    'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default',
    'break', 'continue', 'return', 'goto', 'sizeof', 'typedef',
    'struct', 'union', 'enum', 'static', 'const', 'volatile',
    'extern', 'register', 'auto', 'inline', 'restrict'
  ];
  return cKeywords.includes(word) ||
         CONTROL_KEYWORDS.includes(word as typeof CONTROL_KEYWORDS[number]);
}

/**
 * Check if a word is a builtin or keyword
 */
function isBuiltinOrKeyword(word: string): boolean {
  return isKeyword(word) ||
         BUILTIN_FUNCTIONS.includes(word as typeof BUILTIN_FUNCTIONS[number]) ||
         FIELD_TYPES.includes(word as typeof FIELD_TYPES[number]);
}

/**
 * Find symbol at a specific position in the document
 */
export function findSymbolAtPosition(
  document: TextDocument,
  position: Position
): { word: string; range: Range } | null {
  const text = document.getText();
  const offset = document.offsetAt(position);

  // Find word boundaries
  let start = offset;
  let end = offset;

  // Move start backwards to find beginning of word
  while (start > 0 && isWordChar(text[start - 1])) {
    start--;
  }

  // Move end forwards to find end of word
  while (end < text.length && isWordChar(text[end])) {
    end++;
  }

  if (start === end) {
    return null;
  }

  const word = text.slice(start, end);
  const range = Range.create(
    document.positionAt(start),
    document.positionAt(end)
  );

  return { word, range };
}

/**
 * Check if character is a word character
 */
function isWordChar(char: string): boolean {
  return /[a-zA-Z0-9_]/.test(char);
}

/**
 * Find all references to a symbol
 */
export function findReferences(
  document: TextDocument,
  symbolName: string
): Range[] {
  const references: Range[] = [];
  const text = document.getText();

  // Use regex to find all occurrences
  const regex = new RegExp(`\\b${escapeRegex(symbolName)}\\b`, 'g');
  let match;

  while ((match = regex.exec(text)) !== null) {
    const startPos = document.positionAt(match.index);
    const endPos = document.positionAt(match.index + symbolName.length);
    references.push(Range.create(startPos, endPos));
  }

  return references;
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
