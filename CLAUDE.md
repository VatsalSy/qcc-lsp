# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

`qcc-lsp` is a Language Server Protocol (LSP) implementation for **Basilisk C** — a domain-specific extension of C99 used for computational fluid dynamics (CFD) simulations. It ships as a VS Code extension (with an LSP server) and a standalone CLI tool (`qcc-lsp check|doctor`).

## Commands

### Build
```bash
npm run compile          # Build both server and client
npm run compile:server   # Server only
npm run compile:client   # Client only
npm run watch            # Concurrent watch mode for both
```

### Test
```bash
npm test                 # Run all tests (server + client)
npm run test:server      # Server tests only
npm run test:client      # Client tests only

# Run a single test file
cd server && npx jest test/diagnostics.test.ts
# Run a single test by name
cd server && npx jest -t "test name pattern"
```

### Lint
```bash
npm run lint             # ESLint over client/src and server/src
```

### Versioning & Publishing
```bash
npm run version:patch    # Bump patch version and commit
npm run version:minor
npm run version:major
npm run prepare:npm-package   # Build CLI distribution package
npm run sync:npm-version      # Sync versions across package.json files
```

## Architecture

The repo is a two-package monorepo (server + client) with shared static language resources:

```
qcc-lsp/
├── server/src/          # Node.js LSP server (core logic lives here)
├── client/src/          # VS Code extension (thin client that spawns the server)
├── syntaxes/            # TextMate grammar for syntax highlighting
├── snippets/            # VS Code snippets
├── language-configuration.json
└── package.json         # VS Code extension manifest + workspace root
```

### Request Flow

1. **VS Code extension** (`client/src/extension.ts`) spawns the server subprocess and establishes the LSP connection.
2. **LSP server** (`server/src/server.ts`) is the main entry point — it registers all LSP capability handlers and coordinates between modules.
3. On document open/change/save, `server.ts` calls `runDiagnostics()`:
   - **Primary path**: invokes the `qcc` compiler as a subprocess, parses its stderr output (`diagnostics.ts`)
   - **Fallback path**: delegates to a `clangd` subprocess (`clangdClient.ts`) if qcc is unavailable/disabled; then filters out Basilisk DSL false-positives via `basiliskDetect.ts`
4. Language features (completion, hover, go-to-definition, symbols) are served from in-memory data structures populated by `basiliskLanguage.ts`, `basiliskDocs.ts`, and `symbols.ts`.

### Key Server Modules

| File | Responsibility |
|------|---------------|
| `server.ts` | LSP protocol registration, document lifecycle, request dispatch |
| `diagnostics.ts` | Runs `qcc`, parses compiler output into LSP Diagnostic objects; also contains `quickValidate()` for fast pre-save checks |
| `symbols.ts` | Regex-based extraction of events, functions, and field declarations from source text |
| `basiliskLanguage.ts` | Static keyword/type/function lists; generates CompletionItems |
| `basiliskDocs.ts` | Built-in hover documentation database (plain object map keyed by symbol name) |
| `basiliskDetect.ts` | Heuristics to identify Basilisk DSL constructs that confuse clangd; suppresses those diagnostics |
| `clangdClient.ts` | Manages the clangd subprocess lifecycle and proxies LSP requests to it |
| `clangdConfig.ts` | Resolves clangd binary path and compilation flags |
| `projectConfig.ts` | Loads `.comphy-basilisk` project config file (include paths, qcc flags, etc.) |
| `cli.ts` | CLI entry point for `qcc-lsp check` and `qcc-lsp doctor` commands |

### Configuration Hierarchy (lowest → highest precedence)

1. Hard defaults in `diagnostics.ts` (`defaultSettings`)
2. VS Code `settings.json` (`basilisk.*` namespace)
3. `.comphy-basilisk` JSON file in the workspace root
4. CLI flags (when using `qcc-lsp` CLI)

## Key Conventions

- **TypeScript strict mode** is enforced in both packages.
- Language keyword/type lists are `const` arrays in `basiliskLanguage.ts` (e.g., `CONTROL_KEYWORDS`, `FIELD_TYPES`, `BUILTIN_FUNCTIONS`). Add new Basilisk builtins there.
- Diagnostics from clangd are always post-processed through `basiliskDetect.ts` before being sent to the client — never forward raw clangd diagnostics.
- Tests live in `server/test/*.test.ts` and focus on Basilisk-specific logic (diagnostic parsing, symbol extraction, DSL detection), not general LSP protocol behavior.
- The compiled output goes to `server/out/` and `client/out/` — never edit files there.
- The root `package.json` `postinstall` script automatically installs dependencies in both `server/` and `client/`, so a top-level `npm install` is sufficient for setup.
