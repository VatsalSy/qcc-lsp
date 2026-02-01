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
  CompletionList,
  HoverParams,
  Hover,
  MarkupKind,
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
  DidChangeConfigurationNotification,
  WorkspaceFolder
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import * as path from 'path';

import {
  createCompletionItems,
  getHoverDocumentation,
  isBasiliskKeyword,
  getKeywordCategory,
  BUILTIN_FUNCTIONS
} from './basiliskLanguage';

import {
  runDiagnostics,
  quickValidate,
  BasiliskSettings,
  BasiliskSettingsInput,
  defaultSettings,
  checkQccAvailable
} from './diagnostics';

import {
  SymbolIndex,
  findSymbolAtPosition,
  findReferences
} from './symbols';

import { ClangdClient } from './clangdClient';
import {
  resolvePathSetting,
  resolveBasiliskRoot,
  deriveBasiliskFallbackFlags,
  mergeFlags
} from './clangdConfig';
import { filterClangdDiagnostics } from './basiliskDetect';
import { loadProjectConfig, ProjectConfig } from './projectConfig';

// Create connection and document manager
const connection = createConnection(ProposedFeatures.all);
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

// Symbol index for workspace navigation
const symbolIndex = new SymbolIndex();

// Settings
let globalSettings: BasiliskSettings = defaultSettings;
const documentSettings: Map<string, Thenable<BasiliskSettings>> = new Map();

// Workspace info
let workspaceRootUri: string | null = null;
let workspaceFolders: WorkspaceFolder[] | null = null;

// clangd integration
let clangdClient: ClangdClient | null = null;
let clangdConfigKey: string | null = null;
const clangdDiagnostics: Map<string, Diagnostic[]> = new Map();
const localDiagnostics: Map<string, Diagnostic[]> = new Map();
const clangdDiagnosticsGeneration: Map<string, number> = new Map();
const localDiagnosticsVersion: Map<string, number> = new Map();

// Initialize params cache
let initializeParams: InitializeParams | null = null;

// Capability flags
let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;

// Cached completion items
let completionItems: CompletionItem[] | null = null;

const projectConfigWarnings = new Set<string>();

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
  initializeParams = params;
  workspaceRootUri = params.rootUri ?? null;
  workspaceFolders = params.workspaceFolders ?? null;

  const capabilities = params.capabilities;

  hasConfigurationCapability = !!(
    capabilities.workspace && !!capabilities.workspace.configuration
  );
  hasWorkspaceFolderCapability = !!(
    capabilities.workspace && !!capabilities.workspace.workspaceFolders
  );
  const initOptions = params.initializationOptions as { basilisk?: { clangd?: { mode?: string } } } | undefined;
  const initClangdMode = initOptions?.basilisk?.clangd?.mode;
  const disableCoreProviders = initClangdMode === 'augment';

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
      definitionProvider: !disableCoreProviders,

      // Find references
      referencesProvider: !disableCoreProviders,

      // Document symbols
      documentSymbolProvider: !disableCoreProviders,

      // Workspace symbols
      workspaceSymbolProvider: !disableCoreProviders,

      // Semantic tokens
      semanticTokensProvider: disableCoreProviders
        ? undefined
        : {
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

  await refreshGlobalSettings();
  const qccAvailable = await checkQccAndLog(globalSettings);
  try {
    await ensureClangd(globalSettings, qccAvailable);
  } catch (error) {
    if (!qccAvailable) {
      const message = `clangd error: ${(error as Error).message}`;
      connection.console.error(message);
      void connection.window.showErrorMessage(message);
    }
  }
});

/**
 * Configuration change handler
 */
connection.onDidChangeConfiguration(async change => {
  if (hasConfigurationCapability) {
    documentSettings.clear();
    await refreshGlobalSettings();
  } else {
    const rootPath = getWorkspaceRootPath();
    const base = applyProjectConfig(defaultSettings, rootPath);
    const merged = mergeSettings(base, (change.settings?.basilisk || {}) as BasiliskSettingsInput);
    globalSettings = resolveQccIncludePaths(merged, rootPath);
  }

  const qccAvailable = await checkQccAndLog(globalSettings);
  try {
    await ensureClangd(globalSettings, qccAvailable);
  } catch (error) {
    if (!qccAvailable) {
      const message = `clangd error: ${(error as Error).message}`;
      connection.console.error(message);
      void connection.window.showErrorMessage(message);
    }
  }

  // Revalidate all open documents
  documents.all().forEach((document) => {
    void validateTextDocument(document, 'open');
  });
});

connection.onDidChangeWatchedFiles(async () => {
  documentSettings.clear();
  await refreshGlobalSettings();
  const qccAvailable = await checkQccAndLog(globalSettings);
  try {
    await ensureClangd(globalSettings, qccAvailable);
  } catch (error) {
    if (!qccAvailable) {
      const message = `clangd error: ${(error as Error).message}`;
      connection.console.error(message);
      void connection.window.showErrorMessage(message);
    }
  }

  documents.all().forEach((document) => {
    void validateTextDocument(document, 'open');
  });
});

/**
 * Get document settings
 */
function getDocumentSettings(resource: string): Thenable<BasiliskSettings> {
  if (!hasConfigurationCapability) {
    return Promise.resolve(globalSettings);
  }
  let result = documentSettings.get(resource);
  if (!result) {
    result = connection.workspace.getConfiguration({
      scopeUri: resource,
      section: 'basilisk'
    }).then((config) => {
      const filePath = URI.parse(resource).fsPath;
      const base = applyProjectConfig(defaultSettings, path.dirname(filePath));
      const merged = mergeSettings(base, config as BasiliskSettingsInput);
      const rootPath = getWorkspaceRootPath() || path.dirname(filePath);
      return resolveQccIncludePaths(merged, rootPath);
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
  forwardDidOpen(event.document);
  void validateTextDocument(event.document, 'open');
});

/**
 * Document content changed
 */
documents.onDidChangeContent(change => {
  symbolIndex.indexDocument(change.document);
  forwardDidChange(change.document);
  void validateTextDocument(change.document, 'change');
});

/**
 * Document closed
 */
documents.onDidClose(event => {
  documentSettings.delete(event.document.uri);
  symbolIndex.removeDocument(event.document.uri);
  localDiagnostics.delete(event.document.uri);
  localDiagnosticsVersion.delete(event.document.uri);
  clangdDiagnostics.delete(event.document.uri);
  clangdDiagnosticsGeneration.delete(event.document.uri);
  connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
  forwardDidClose(event.document);
});

/**
 * Document saved - run full diagnostics
 */
documents.onDidSave(async event => {
  forwardDidSave(event.document);
  void validateTextDocument(event.document, 'save');
});

/**
 * Validate a document
 */
type DiagnosticsTrigger = 'open' | 'change' | 'save';

async function validateTextDocument(document: TextDocument, trigger: DiagnosticsTrigger): Promise<void> {
  const settings = await getDocumentSettings(document.uri);
  if (trigger === 'change' && !settings.diagnosticsOnType) {
    return;
  }
  if (trigger === 'save' && !settings.diagnosticsOnSave) {
    return;
  }
  const version = document.version;
  localDiagnosticsVersion.set(document.uri, version);
  const diagnostics = await collectLocalDiagnostics(document, settings, trigger);
  if (localDiagnosticsVersion.get(document.uri) !== version) {
    return;
  }
  localDiagnostics.set(document.uri, diagnostics);
  publishDiagnostics(document.uri, settings);
}

function mergeStringArrays(primary: string[], secondary: string[] | undefined): string[] {
  if (!secondary || secondary.length === 0) {
    return primary;
  }
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const entry of [...primary, ...secondary]) {
    if (!entry || seen.has(entry)) {
      continue;
    }
    seen.add(entry);
    merged.push(entry);
  }
  return merged;
}

function mergeSettings(base: BasiliskSettings, partial: BasiliskSettingsInput): BasiliskSettings {
  const mergedQcc = {
    ...base.qcc,
    ...(partial.qcc || {})
  };
  mergedQcc.includePaths = mergeStringArrays(
    base.qcc?.includePaths ?? [],
    partial.qcc?.includePaths
  );

  return {
    ...base,
    ...partial,
    qcc: mergedQcc,
    clangd: {
      ...base.clangd,
      ...(partial.clangd || {})
    }
  };
}

function projectConfigToSettings(config: ProjectConfig): BasiliskSettingsInput {
  const partial: BasiliskSettingsInput = {};
  if (config.qccPath) {
    partial.qccPath = config.qccPath;
  }
  if (config.basiliskPath) {
    partial.basiliskPath = config.basiliskPath;
  }
  if (config.qcc?.includePaths) {
    partial.qcc = { includePaths: config.qcc.includePaths };
  }
  if (config.clangd) {
    partial.clangd = { ...config.clangd };
  }
  return partial;
}

function applyProjectConfig(base: BasiliskSettings, startDir: string | null): BasiliskSettings {
  if (!startDir) {
    return base;
  }
  const result = loadProjectConfig(startDir);
  if (result.error && result.path && !projectConfigWarnings.has(result.path)) {
    projectConfigWarnings.add(result.path);
    connection.console.warn(`Failed to parse ${result.path}: ${result.error}`);
  }
  if (!result.config) {
    return base;
  }
  return mergeSettings(base, projectConfigToSettings(result.config));
}

function resolveQccIncludePaths(settings: BasiliskSettings, baseDir: string | null): BasiliskSettings {
  const includePaths = settings.qcc?.includePaths ?? [];
  if (includePaths.length === 0) {
    return settings;
  }
  const resolved = includePaths.map((entry) => resolvePathSetting(entry, baseDir));
  return {
    ...settings,
    qcc: {
      ...settings.qcc,
      includePaths: resolved
    }
  };
}

async function refreshGlobalSettings(): Promise<void> {
  if (!hasConfigurationCapability) {
    return;
  }

  try {
    const config = await connection.workspace.getConfiguration({ section: 'basilisk' });
    const rootPath = getWorkspaceRootPath();
    const base = applyProjectConfig(defaultSettings, rootPath);
    const merged = mergeSettings(base, config as BasiliskSettingsInput);
    globalSettings = resolveQccIncludePaths(merged, rootPath);
  } catch {
    const rootPath = getWorkspaceRootPath();
    const base = applyProjectConfig(defaultSettings, rootPath);
    globalSettings = resolveQccIncludePaths(base, rootPath);
  }
}

async function checkQccAndLog(settings: BasiliskSettings): Promise<boolean> {
  const qccAvailable = await checkQccAvailable(settings.qccPath);
  if (!settings.enableDiagnostics) {
    return qccAvailable;
  }

  if (!qccAvailable) {
    connection.console.warn(
      `qcc compiler not found at '${settings.qccPath}'. ` +
      'Diagnostics will be limited. Set basilisk.qccPath in settings.'
    );
  } else {
    connection.console.log('Basilisk LSP server initialized with qcc support');
  }
  return qccAvailable;
}

function getWorkspaceRootPath(): string | null {
  if (workspaceRootUri) {
    return URI.parse(workspaceRootUri).fsPath;
  }
  if (workspaceFolders && workspaceFolders.length > 0) {
    return URI.parse(workspaceFolders[0].uri).fsPath;
  }
  return null;
}

function buildClangdConfigKey(settings: BasiliskSettings, args: string[], compileCommandsDir: string): string {
  return JSON.stringify({
    path: settings.clangd.path,
    args,
    compileCommandsDir,
    fallbackFlags: settings.clangd.fallbackFlags
  });
}

async function ensureClangd(settings: BasiliskSettings, qccAvailable: boolean): Promise<void> {
  const clangdSettings = settings.clangd;
  const shouldEnable = clangdSettings.enabled && clangdSettings.mode === 'proxy' && !qccAvailable;

  if (!shouldEnable) {
    await stopClangd();
    return;
  }

  if (!initializeParams) {
    return;
  }

  const rootPath = getWorkspaceRootPath();
  const basiliskRoot = resolveBasiliskRoot(settings, rootPath);
  const compileCommandsDir =
    resolvePathSetting(clangdSettings.compileCommandsDir, rootPath) ||
    (basiliskRoot ? basiliskRoot : '');
  const args = [...clangdSettings.args];
  if (compileCommandsDir) {
    args.push(`--compile-commands-dir=${compileCommandsDir}`);
  }

  const derivedFallbackFlags = deriveBasiliskFallbackFlags(basiliskRoot);
  const fallbackFlags = mergeFlags(clangdSettings.fallbackFlags, derivedFallbackFlags);

  const nextKey = buildClangdConfigKey(
    {
      ...settings,
      clangd: {
        ...settings.clangd,
        fallbackFlags
      }
    },
    args,
    compileCommandsDir
  );
  if (clangdClient && clangdConfigKey === nextKey && clangdClient.isReady()) {
    return;
  }

  await stopClangd();

  clangdClient = new ClangdClient(
    {
      path: clangdSettings.path,
      args,
      rootUri: workspaceRootUri,
      workspaceFolders,
      fallbackFlags
    },
    connection.console
  );

  clangdClient.onDiagnostics((uri, diagnostics) => {
    const normalized = diagnostics.map((diagnostic) => ({
      ...diagnostic,
      source: diagnostic.source || 'clangd'
    }));
    const generation = (clangdDiagnosticsGeneration.get(uri) ?? 0) + 1;
    clangdDiagnosticsGeneration.set(uri, generation);
    void (async () => {
      const settings = await getDocumentSettings(uri);
      if (clangdDiagnosticsGeneration.get(uri) !== generation) {
        return;
      }

      let nextDiagnostics: Diagnostic[] = [];
      if (settings.clangd.diagnosticsMode === 'none') {
        nextDiagnostics = [];
      } else if (settings.clangd.diagnosticsMode === 'filtered') {
        const document = documents.get(uri);
        nextDiagnostics = document
          ? filterClangdDiagnostics(normalized, document.getText())
          : normalized;
      } else {
        nextDiagnostics = normalized;
      }

      clangdDiagnostics.set(uri, nextDiagnostics);
      if (settings.diagnosticsOnType) {
        publishDiagnostics(uri, settings);
      }
    })();
  });

  clangdClient.onLog((message) => {
    connection.console.log(message.trim());
  });

  try {
    await clangdClient.start(initializeParams);
    clangdConfigKey = nextKey;
    if (!clangdClient.isReady()) {
      await stopClangd();
      throw new Error('clangd failed to initialize');
    }
  } catch (error) {
    await stopClangd();
    throw error;
  }
}

async function stopClangd(): Promise<void> {
  if (clangdClient) {
    await clangdClient.stop();
  }
  clangdClient = null;
  clangdConfigKey = null;
  clangdDiagnostics.clear();
  clangdDiagnosticsGeneration.clear();
}

function shouldProxyToClangd(settings: BasiliskSettings): boolean {
  return (
    settings.clangd.enabled &&
    settings.clangd.mode === 'proxy' &&
    clangdClient !== null &&
    clangdClient.isReady()
  );
}

async function collectLocalDiagnostics(
  document: TextDocument,
  settings: BasiliskSettings,
  trigger: DiagnosticsTrigger
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  const runOnType = settings.diagnosticsOnType;
  const runOnSave = settings.diagnosticsOnSave;

  const runQuick =
    trigger === 'open' ||
    (trigger === 'change' && runOnType) ||
    (trigger === 'save' && runOnSave);

  if (runQuick) {
    diagnostics.push(...quickValidate(document.getText()));
  }

  const runQcc =
    settings.enableDiagnostics &&
    ((trigger === 'change' && runOnType) || (trigger === 'save' && runOnSave));

  if (runQcc) {
    try {
      const compilerDiagnostics = await runDiagnostics(
        document.uri,
        document.getText(),
        settings,
        connection.console
      );
      diagnostics.push(...compilerDiagnostics);
    } catch (error) {
      const message = (error as Error)?.message || String(error);
      connection.console.warn(`qcc diagnostics failed: ${message}`);
    }
  }

  return diagnostics;
}

function publishDiagnostics(uri: string, settings: BasiliskSettings): void {
  const clangd = clangdDiagnostics.get(uri) || [];
  const local = localDiagnostics.get(uri) || [];
  const merged = dedupeDiagnostics([...clangd, ...local]);
  const limited = merged.slice(0, settings.maxNumberOfProblems);
  connection.sendDiagnostics({ uri, diagnostics: limited });
}

function dedupeDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>();
  const result: Diagnostic[] = [];

  for (const diagnostic of diagnostics) {
    const key = [
      diagnostic.range.start.line,
      diagnostic.range.start.character,
      diagnostic.range.end.line,
      diagnostic.range.end.character,
      diagnostic.severity ?? '',
      diagnostic.message,
      diagnostic.source ?? ''
    ].join(':');
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(diagnostic);
  }

  return result;
}

function forwardDidOpen(document: TextDocument): void {
  if (!clangdClient) {
    return;
  }

  clangdClient.notify('textDocument/didOpen', {
    textDocument: {
      uri: document.uri,
      languageId: document.languageId,
      version: document.version,
      text: document.getText()
    }
  });
}

function forwardDidChange(document: TextDocument): void {
  if (!clangdClient) {
    return;
  }

  clangdClient.notify('textDocument/didChange', {
    textDocument: {
      uri: document.uri,
      version: document.version
    },
    contentChanges: [
      {
        text: document.getText()
      }
    ]
  });
}

function forwardDidClose(document: TextDocument): void {
  if (!clangdClient) {
    return;
  }

  clangdClient.notify('textDocument/didClose', {
    textDocument: { uri: document.uri }
  });
}

function forwardDidSave(document: TextDocument): void {
  if (!clangdClient) {
    return;
  }

  clangdClient.notify('textDocument/didSave', {
    textDocument: { uri: document.uri }
  });
}

function getBasiliskCompletionItems(
  document: TextDocument | undefined,
  params: CompletionParams
): CompletionItem[] {
  if (!completionItems) {
    completionItems = createCompletionItems();
  }

  if (!document) {
    return completionItems;
  }

  const text = document.getText();
  const offset = document.offsetAt(params.position);
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  const lineText = text.slice(lineStart, offset);

  if (/#include\s*["<]/.test(lineText)) {
    return completionItems.filter(item =>
      item.label.endsWith('.h') || item.label.includes('/')
    );
  }

  if (/\w+\.$/.test(lineText)) {
    return [
      { label: 'x', kind: 5, detail: 'X component' },
      { label: 'y', kind: 5, detail: 'Y component' },
      { label: 'z', kind: 5, detail: 'Z component (3D)' }
    ];
  }

  return completionItems;
}

function normalizeCompletionResult(
  result: CompletionItem[] | CompletionList | null | undefined
): CompletionList {
  if (!result) {
    return { isIncomplete: false, items: [] };
  }

  if (Array.isArray(result)) {
    return { isIncomplete: false, items: result };
  }

  return result;
}

function tagCompletionItems(items: CompletionItem[], source: string): CompletionItem[] {
  return items.map((item) => {
    const tagged = { ...item } as CompletionItem & { _basiliskSource?: string };
    if (tagged.data && typeof tagged.data === 'object' && !Array.isArray(tagged.data)) {
      tagged.data = {
        ...tagged.data,
        _basiliskSource: source
      };
    } else {
      tagged._basiliskSource = source;
    }
    return tagged;
  });
}

function isClangdCompletionItem(item: CompletionItem): boolean {
  const data = item.data as { _basiliskSource?: string } | undefined;
  if (data && data._basiliskSource === 'clangd') {
    return true;
  }

  const tagged = item as CompletionItem & { _basiliskSource?: string };
  return tagged._basiliskSource === 'clangd';
}

function mergeCompletionResults(
  clangdResult: CompletionItem[] | CompletionList | null | undefined,
  basiliskItems: CompletionItem[]
): CompletionList {
  const clangdList = normalizeCompletionResult(clangdResult);
  const taggedClangd = tagCompletionItems(clangdList.items, 'clangd');
  const taggedBasilisk = tagCompletionItems(basiliskItems, 'basilisk');

  const seen = new Set<string>();
  const merged: CompletionItem[] = [];

  const pushItem = (item: CompletionItem) => {
    const key = item.label;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    merged.push(item);
  };

  taggedClangd.forEach(pushItem);
  taggedBasilisk.forEach(pushItem);

  return {
    isIncomplete: clangdList.isIncomplete ?? false,
    items: merged
  };
}

function buildBasiliskHover(document: TextDocument, params: HoverParams): Hover | null {
  const symbolInfo = findSymbolAtPosition(document, params.position);
  if (!symbolInfo) {
    return null;
  }

  const { word } = symbolInfo;
  const doc = getHoverDocumentation(word);
  if (doc) {
    return {
      contents: {
        kind: 'markdown',
        value: doc
      }
    };
  }

  if (isBasiliskKeyword(word)) {
    const category = getKeywordCategory(word);
    return {
      contents: {
        kind: 'markdown',
        value: `**${word}** (Basilisk ${category})`
      }
    };
  }

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
}

type HoverContent = Hover['contents'] extends (infer T)[] ? T : Hover['contents'];

function hoverContentHasValue(content: HoverContent): boolean {
  if (typeof content === 'string') {
    return content.trim().length > 0;
  }
  if (content && typeof content === 'object' && 'value' in content) {
    return typeof content.value === 'string' && content.value.trim().length > 0;
  }
  return false;
}

function hoverHasContent(hover: Hover | null): hover is Hover {
  if (!hover) {
    return false;
  }
  const contents = hover.contents;
  if (Array.isArray(contents)) {
    return contents.some(hoverContentHasValue);
  }
  return hoverContentHasValue(contents);
}

function mergeHovers(primary: Hover | null, secondary: Hover | null): Hover | null {
  const effectivePrimary = hoverHasContent(primary) ? primary : null;
  const effectiveSecondary = hoverHasContent(secondary) ? secondary : null;

  if (!effectivePrimary && !effectiveSecondary) {
    return null;
  }
  if (effectivePrimary && !effectiveSecondary) {
    return effectivePrimary;
  }
  if (!effectivePrimary && effectiveSecondary) {
    return effectiveSecondary;
  }

  const primaryContents = effectivePrimary?.contents;
  const secondaryContents = effectiveSecondary?.contents;
  const combined: Hover = {
    contents: []
  };

  const pushContent = (content: Hover['contents'] | undefined) => {
    if (!content) {
      return;
    }
    if (Array.isArray(content)) {
      (combined.contents as typeof content).push(...content);
      return;
    }
    (combined.contents as typeof content[]).push(content);
  };

  pushContent(primaryContents);
  if (secondaryContents) {
    const separator = { kind: MarkupKind.Markdown, value: '\n---\n' };
    pushContent(separator);
    pushContent(secondaryContents);
  }

  if (effectivePrimary?.range) {
    combined.range = effectivePrimary.range;
  }

  return combined;
}

/**
 * Completion handler
 */
connection.onCompletion(async (params: CompletionParams): Promise<CompletionItem[] | CompletionList> => {
  const document = documents.get(params.textDocument.uri);
  const basiliskItems = getBasiliskCompletionItems(document, params);
  const settings = await getDocumentSettings(params.textDocument.uri);

  if (!shouldProxyToClangd(settings)) {
    return basiliskItems;
  }

  try {
    const clangdResult = await clangdClient?.request('textDocument/completion', params);
    return mergeCompletionResults(
      clangdResult as CompletionItem[] | CompletionList | null | undefined,
      basiliskItems
    );
  } catch {
    return basiliskItems;
  }
});

/**
 * Completion item resolution
 */
connection.onCompletionResolve(async (item: CompletionItem): Promise<CompletionItem> => {
  let resolved = item;

  if (isClangdCompletionItem(item) && clangdClient?.isReady()) {
    try {
      const clangdResolved = await clangdClient.request('completionItem/resolve', item);
      if (clangdResolved) {
        resolved = clangdResolved as CompletionItem;
      }
    } catch {
      // Fall back to existing item.
    }
  }

  const doc = getHoverDocumentation(resolved.label);
  if (doc && !resolved.documentation) {
    resolved.documentation = {
      kind: 'markdown',
      value: doc
    };
  }
  return resolved;
});

/**
 * Hover handler
 */
connection.onHover(async (params: HoverParams): Promise<Hover | null> => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return null;
  }

  const settings = await getDocumentSettings(params.textDocument.uri);
  const basiliskHover = buildBasiliskHover(document, params);
  let clangdHover: Hover | null = null;

  if (shouldProxyToClangd(settings)) {
    try {
      const result = await clangdClient?.request('textDocument/hover', params);
      clangdHover = (result as Hover) || null;
    } catch {
      clangdHover = null;
    }
  }

  return mergeHovers(clangdHover, basiliskHover);
});

/**
 * Go to definition handler
 */
connection.onDefinition(async (params: DefinitionParams): Promise<Definition | null> => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return null;
  }

  const settings = await getDocumentSettings(params.textDocument.uri);
  if (shouldProxyToClangd(settings)) {
    try {
      const result = await clangdClient?.request('textDocument/definition', params);
      if (result) {
        return result as Definition;
      }
    } catch {
      // Fall back to Basilisk symbols.
    }
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
connection.onReferences(async (params: ReferenceParams): Promise<Location[]> => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return [];
  }

  const settings = await getDocumentSettings(params.textDocument.uri);
  if (shouldProxyToClangd(settings)) {
    try {
      const result = await clangdClient?.request('textDocument/references', params);
      if (Array.isArray(result)) {
        return result as Location[];
      }
    } catch {
      // Fall back to Basilisk references.
    }
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
connection.onDocumentSymbol(async (params: DocumentSymbolParams): Promise<DocumentSymbol[]> => {
  const settings = await getDocumentSettings(params.textDocument.uri);
  if (shouldProxyToClangd(settings)) {
    try {
      const result = await clangdClient?.request('textDocument/documentSymbol', params);
      if (Array.isArray(result)) {
        return result as DocumentSymbol[];
      }
    } catch {
      // Fall back to Basilisk symbols.
    }
  }

  return symbolIndex.getDocumentSymbols(params.textDocument.uri);
});

/**
 * Workspace symbols handler
 */
connection.onWorkspaceSymbol(async (params: WorkspaceSymbolParams): Promise<SymbolInformation[]> => {
  const settings = globalSettings;
  if (shouldProxyToClangd(settings)) {
    try {
      const result = await clangdClient?.request('workspace/symbol', params);
      if (Array.isArray(result)) {
        return result as SymbolInformation[];
      }
    } catch {
      // Fall back to Basilisk symbols.
    }
  }

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
