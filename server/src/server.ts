/**
 * Basilisk C Language Server
 *
 * A Language Server Protocol implementation for Basilisk C,
 * providing diagnostics, code completion, hover information,
 * go-to-definition, and more.
 */

import {
  createConnection,
  TextDocuments,
  Diagnostic,
  ProposedFeatures,
  InitializeParams,
  InitializeResult,
  TextDocumentSyncKind,
  CompletionItem,
  CompletionParams,
  HoverParams,
  Hover,
  DefinitionParams,
  Definition,
  DocumentSymbolParams,
  DocumentSymbol,
  WorkspaceSymbolParams,
  SymbolInformation,
  ReferenceParams,
  Location,
  SemanticTokensParams,
  SemanticTokens,
  SemanticTokensLegend,
  SemanticTokensBuilder,
  DidChangeConfigurationNotification
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';

import {
  createCompletionItems,
  getHoverDocumentation,
  isBasiliskKeyword,
  getKeywordCategory,
  CONTROL_KEYWORDS,
  FIELD_TYPES,
  BUILTIN_FUNCTIONS,
  CONSTANTS,
  LOOP_VARIABLES,
  MPI_KEYWORDS
} from './basiliskLanguage';

import {
  runDiagnostics,
  quickValidate,
  DiagnosticsSettings,
  defaultSettings,
  checkQccAvailable
} from './diagnostics';

import {
  SymbolIndex,
  findSymbolAtPosition,
  findReferences
} from './symbols';

// Create connection and document manager
const connection = createConnection(ProposedFeatures.all);
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

// Symbol index for workspace navigation
const symbolIndex = new SymbolIndex();

// Settings
let globalSettings: DiagnosticsSettings = defaultSettings;
const documentSettings: Map<string, Thenable<DiagnosticsSettings>> = new Map();

// Capability flags
let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let hasDiagnosticRelatedInformationCapability = false;

// Cached completion items
let completionItems: CompletionItem[] | null = null;

// Semantic token types and modifiers
const tokenTypes = [
  'keyword',      // 0
  'type',         // 1
  'function',     // 2
  'variable',     // 3
  'parameter',    // 4
  'property',     // 5
  'number',       // 6
  'string',       // 7
  'comment',      // 8
  'operator',     // 9
  'macro',        // 10
  'namespace',    // 11
  'event'         // 12
];

const tokenModifiers = [
  'declaration',
  'definition',
  'readonly',
  'static',
  'deprecated',
  'modification',
  'documentation'
];

const legend: SemanticTokensLegend = {
  tokenTypes,
  tokenModifiers
};

/**
 * Initialize the server
 */
connection.onInitialize((params: InitializeParams): InitializeResult => {
  const capabilities = params.capabilities;

  hasConfigurationCapability = !!(
    capabilities.workspace && !!capabilities.workspace.configuration
  );
  hasWorkspaceFolderCapability = !!(
    capabilities.workspace && !!capabilities.workspace.workspaceFolders
  );
  hasDiagnosticRelatedInformationCapability = !!(
    capabilities.textDocument &&
    capabilities.textDocument.publishDiagnostics &&
    capabilities.textDocument.publishDiagnostics.relatedInformation
  );

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,

      // Completion
      completionProvider: {
        resolveProvider: true,
        triggerCharacters: ['.', '#', '<', '"', '/']
      },

      // Hover
      hoverProvider: true,

      // Go to definition
      definitionProvider: true,

      // Find references
      referencesProvider: true,

      // Document symbols
      documentSymbolProvider: true,

      // Workspace symbols
      workspaceSymbolProvider: true,

      // Semantic tokens
      semanticTokensProvider: {
        legend,
        full: true
      }
    }
  };

  if (hasWorkspaceFolderCapability) {
    result.capabilities.workspace = {
      workspaceFolders: {
        supported: true
      }
    };
  }

  return result;
});

/**
 * Server initialized
 */
connection.onInitialized(async () => {
  if (hasConfigurationCapability) {
    connection.client.register(DidChangeConfigurationNotification.type, undefined);
  }

  // Check if qcc is available
  const qccAvailable = await checkQccAvailable(globalSettings.qccPath);
  if (!qccAvailable) {
    connection.console.warn(
      `qcc compiler not found at '${globalSettings.qccPath}'. ` +
      'Diagnostics will be limited. Set basilisk.qccPath in settings.'
    );
  } else {
    connection.console.log('Basilisk LSP server initialized with qcc support');
  }
});

/**
 * Configuration change handler
 */
connection.onDidChangeConfiguration(change => {
  if (hasConfigurationCapability) {
    documentSettings.clear();
  } else {
    globalSettings = {
      ...defaultSettings,
      ...(change.settings?.basilisk || {})
    };
  }

  // Revalidate all open documents
  documents.all().forEach(validateTextDocument);
});

/**
 * Get document settings
 */
function getDocumentSettings(resource: string): Thenable<DiagnosticsSettings> {
  if (!hasConfigurationCapability) {
    return Promise.resolve(globalSettings);
  }
  let result = documentSettings.get(resource);
  if (!result) {
    result = connection.workspace.getConfiguration({
      scopeUri: resource,
      section: 'basilisk'
    });
    documentSettings.set(resource, result);
  }
  return result;
}

/**
 * Document opened
 */
documents.onDidOpen(event => {
  symbolIndex.indexDocument(event.document);
  validateTextDocument(event.document);
});

/**
 * Document content changed
 */
documents.onDidChangeContent(change => {
  symbolIndex.indexDocument(change.document);
  validateTextDocument(change.document);
});

/**
 * Document closed
 */
documents.onDidClose(event => {
  documentSettings.delete(event.document.uri);
  symbolIndex.removeDocument(event.document.uri);
  connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

/**
 * Document saved - run full diagnostics
 */
documents.onDidSave(async event => {
  const settings = await getDocumentSettings(event.document.uri);
  if (settings.enableDiagnostics) {
    const diagnostics = await runDiagnostics(
      event.document.uri,
      event.document.getText(),
      settings
    );
    connection.sendDiagnostics({ uri: event.document.uri, diagnostics });
  }
});

/**
 * Validate a document
 */
async function validateTextDocument(document: TextDocument): Promise<void> {
  const settings = await getDocumentSettings(document.uri);

  // Quick validation (always run)
  const quickDiagnostics = quickValidate(document.getText());

  // Full validation with qcc (optional, can be slow)
  let compilerDiagnostics: Diagnostic[] = [];
  if (settings.enableDiagnostics) {
    try {
      compilerDiagnostics = await runDiagnostics(
        document.uri,
        document.getText(),
        settings
      );
    } catch {
      // Compiler validation failed, use quick validation only
    }
  }

  // Combine diagnostics
  const allDiagnostics = [...quickDiagnostics, ...compilerDiagnostics];

  // Limit number of problems
  const limitedDiagnostics = allDiagnostics.slice(0, settings.maxNumberOfProblems);

  connection.sendDiagnostics({ uri: document.uri, diagnostics: limitedDiagnostics });
}

/**
 * Completion handler
 */
connection.onCompletion((params: CompletionParams): CompletionItem[] => {
  // Lazy initialization of completion items
  if (!completionItems) {
    completionItems = createCompletionItems();
  }

  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return completionItems;
  }

  // Get context around cursor
  const text = document.getText();
  const offset = document.offsetAt(params.position);

  // Check for include completion
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  const lineText = text.slice(lineStart, offset);

  if (/#include\s*["<]/.test(lineText)) {
    // Return header completions
    return completionItems.filter(item =>
      item.label.endsWith('.h') || item.label.includes('/')
    );
  }

  // Check for field component completion (e.g., "u.")
  if (/\w+\.$/.test(lineText)) {
    return [
      { label: 'x', kind: 5, detail: 'X component' },
      { label: 'y', kind: 5, detail: 'Y component' },
      { label: 'z', kind: 5, detail: 'Z component (3D)' }
    ];
  }

  return completionItems;
});

/**
 * Completion item resolution
 */
connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
  // Add additional documentation if available
  const doc = getHoverDocumentation(item.label);
  if (doc && !item.documentation) {
    item.documentation = {
      kind: 'markdown',
      value: doc
    };
  }
  return item;
});

/**
 * Hover handler
 */
connection.onHover((params: HoverParams): Hover | null => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return null;
  }

  const symbolInfo = findSymbolAtPosition(document, params.position);
  if (!symbolInfo) {
    return null;
  }

  const { word } = symbolInfo;

  // Check for Basilisk documentation
  const doc = getHoverDocumentation(word);
  if (doc) {
    return {
      contents: {
        kind: 'markdown',
        value: doc
      }
    };
  }

  // Check if it's a known keyword
  if (isBasiliskKeyword(word)) {
    const category = getKeywordCategory(word);
    return {
      contents: {
        kind: 'markdown',
        value: `**${word}** (Basilisk ${category})`
      }
    };
  }

  // Check if it's a user-defined symbol
  const symbol = symbolIndex.findDefinition(word);
  if (symbol) {
    return {
      contents: {
        kind: 'markdown',
        value: `**${symbol.name}**\n\n${symbol.detail || ''}`
      }
    };
  }

  return null;
});

/**
 * Go to definition handler
 */
connection.onDefinition((params: DefinitionParams): Definition | null => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return null;
  }

  const symbolInfo = findSymbolAtPosition(document, params.position);
  if (!symbolInfo) {
    return null;
  }

  const { word } = symbolInfo;

  // Find in symbol index
  const symbol = symbolIndex.findDefinition(word);
  if (symbol) {
    return symbol.location;
  }

  // TODO: Search Basilisk headers for builtin definitions

  return null;
});

/**
 * Find references handler
 */
connection.onReferences((params: ReferenceParams): Location[] => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return [];
  }

  const symbolInfo = findSymbolAtPosition(document, params.position);
  if (!symbolInfo) {
    return [];
  }

  const { word } = symbolInfo;
  const references = findReferences(document, word);

  return references.map(range => ({
    uri: params.textDocument.uri,
    range
  }));
});

/**
 * Document symbols handler
 */
connection.onDocumentSymbol((params: DocumentSymbolParams): DocumentSymbol[] => {
  return symbolIndex.getDocumentSymbols(params.textDocument.uri);
});

/**
 * Workspace symbols handler
 */
connection.onWorkspaceSymbol((params: WorkspaceSymbolParams): SymbolInformation[] => {
  const symbols = symbolIndex.findSymbols(params.query);

  return symbols.map(s => ({
    name: s.name,
    kind: s.kind,
    location: s.location,
    containerName: s.containerName
  }));
});

/**
 * Semantic tokens handler
 */
connection.languages.semanticTokens.on((params: SemanticTokensParams): SemanticTokens => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return { data: [] };
  }

  const builder = new SemanticTokensBuilder();
  const text = document.getText();
  const lines = text.split('\n');

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];

    // Skip empty lines
    if (!line.trim()) {
      continue;
    }

    // Find tokens in line
    let match: RegExpExecArray | null;

    // Match keywords
    const keywordRegex = /\b(foreach|foreach_face|foreach_vertex|foreach_boundary|foreach_dimension|foreach_neighbor|foreach_level|foreach_leaf|foreach_cell|foreach_child|foreach_block|event|reduction)\b/g;
    while ((match = keywordRegex.exec(line)) !== null) {
      builder.push(lineNum, match.index, match[0].length, 0, 0); // keyword
    }

    // Match types
    const typeRegex = /\b(scalar|vector|tensor|face|vertex|coord|point|symmetric)\b/g;
    while ((match = typeRegex.exec(line)) !== null) {
      builder.push(lineNum, match.index, match[0].length, 1, 0); // type
    }

    // Match functions (basic heuristic: word followed by opening paren)
    const funcRegex = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;
    while ((match = funcRegex.exec(line)) !== null) {
      const funcName = match[1];
      if (BUILTIN_FUNCTIONS.includes(funcName as typeof BUILTIN_FUNCTIONS[number])) {
        builder.push(lineNum, match.index, funcName.length, 2, 0); // function
      }
    }

    // Match constants
    const constantRegex = /\b(PI|M_PI|HUGE|nodata|true|false|NULL|N|L0|X0|Y0|Z0|DT|TOLERANCE)\b/g;
    while ((match = constantRegex.exec(line)) !== null) {
      builder.push(lineNum, match.index, match[0].length, 3, 2); // variable + readonly
    }

    // Match loop variables (when inside foreach)
    const loopVarRegex = /\b(Delta|level|depth|point|child|neighbor|left|right|top|bottom|front|back)\b/g;
    while ((match = loopVarRegex.exec(line)) !== null) {
      builder.push(lineNum, match.index, match[0].length, 4, 0); // parameter
    }

    // Match MPI keywords
    const mpiRegex = /\b(MPI_\w+|mpi_\w+|pid|npe)\b/g;
    while ((match = mpiRegex.exec(line)) !== null) {
      builder.push(lineNum, match.index, match[0].length, 11, 0); // namespace
    }

    // Match preprocessor
    const preRegex = /^\s*(#\w+)/;
    match = preRegex.exec(line);
    if (match) {
      builder.push(lineNum, match.index + line.indexOf(match[1]), match[1].length, 10, 0); // macro
    }
  }

  return builder.build();
});

// Start listening
documents.listen(connection);
connection.listen();

connection.console.log('Basilisk C Language Server started');
