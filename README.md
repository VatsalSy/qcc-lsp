# Basilisk C Language Server (qcc-lsp)

Language Server Protocol (LSP) implementation for [Basilisk C](http://basilisk.fr/), the domain-specific language for computational fluid dynamics simulations.

## Overview

This project provides a complete Language Server Protocol server for Basilisk C, enabling rich IDE features in any LSP-compatible editor (VS Code, Neovim, Emacs with lsp-mode, etc.). It uses qcc as the primary compiler/diagnostic source and falls back to clangd only when qcc is unavailable (or disabled).

Basilisk C extends C99 with domain-specific constructs for grid operations, field manipulation, and parallel computing. This LSP understands these extensions and provides intelligent assistance.

## Features

### Implemented

- **Syntax Highlighting** - Full TextMate grammar for Basilisk C with support for:
  - `foreach` loops and variants (`foreach_face`, `foreach_vertex`, `foreach_boundary`, etc.)
  - `event` definitions with timing parameters
  - Field types (`scalar`, `vector`, `tensor`, `face`, `vertex`)
  - Boundary conditions (`dirichlet`, `neumann`)
  - Reduction operations
  - MPI keywords and functions

- **Code Completion** - IntelliSense for:
  - Basilisk keywords and control structures
  - Field types and declarations
  - Built-in functions and solvers
  - Common include headers
  - Constants and loop variables
  - Code snippets for common patterns

- **Hover Documentation** - Detailed documentation on hover for:
  - All Basilisk constructs (`foreach`, `event`, etc.)
  - Field types and their usage
  - Built-in functions with examples
  - Special variables (`Delta`, `level`, `t`, `dt`, etc.)

- **Diagnostics** - Error detection via:
  - Integration with `qcc` compiler for full syntax checking
  - Quick validation for common mistakes
  - Configurable error limits
  - clangd diagnostics fallback (when qcc is unavailable)

- **Go-to-Definition** - Navigate to symbol definitions

- **Find References** - Find all usages of a symbol

- **Document Symbols** - Outline view with:
  - Events
  - Functions
  - Field declarations
  - Macros and constants

- **Workspace Symbols** - Search across all files

- **Semantic Tokens** - Enhanced highlighting based on symbol meaning

- **Code Snippets** - Templates for:
  - Events (init, adapt, output, end)
  - Foreach loops (all variants)
  - Field declarations
  - Boundary conditions
  - Main function templates
  - Complete simulation templates

## Installation

### Prerequisites

1. **Node.js** (v18 or later) - required for building from source or using the CLI
2. **Basilisk** installation with `qcc` compiler
   - Follow installation at http://basilisk.fr/src/INSTALL
3. **clangd** (optional, but recommended for deep C/C++ semantics)
   - Install clangd via your system package manager or LLVM distribution.

### Building from Source

```bash
# Clone the repository
git clone https://github.com/VatsalSy/qcc-lsp.git
cd qcc-lsp

# Install dependencies
npm install

# Build the extension
npm run compile
```

### VS Code Extension

#### VS Marketplace (recommended)

1. Open VS Code and go to Extensions (Ctrl+Shift+X)
2. Search for **Basilisk C Language Support** (publisher: `basilisk-cfd`)
3. Install the extension

#### Open VSX

1. Open VS Code and go to Extensions (Ctrl+Shift+X)
2. Search for **Basilisk C Language Support** (publisher: `basilisk-cfd`)
3. Install the extension

#### From VSIX (local build)

```bash
npm install
npm run compile
npx @vscode/vsce package
```

Then in VS Code:

1. Open Extensions (Ctrl+Shift+X)
2. Click "..." > "Install from VSIX..."
3. Select the generated `.vsix` file

#### Development

```bash
# Open in VS Code
code .

# Press F5 to launch Extension Development Host
```

### CLI (GitHub Packages)

The CLI is published to GitHub Packages as `@vatsalsy/qcc-lsp`.
GitHub Packages requires authentication even for public packages.

```bash
npm config set @vatsalsy:registry https://npm.pkg.github.com
npm login --registry=https://npm.pkg.github.com --scope=@vatsalsy
npm install -g @vatsalsy/qcc-lsp
```

Convenience script (from the repo root):

```bash
./install-cli.sh
```

Non-interactive installs (CI):

```bash
npm config set @vatsalsy:registry https://npm.pkg.github.com
npm config set //npm.pkg.github.com/:_authToken=YOUR_GITHUB_TOKEN
npm install -g @vatsalsy/qcc-lsp
```

### Other Editors

The LSP server can be used with any LSP-compatible editor:

**Neovim (with nvim-lspconfig):**

```lua
local lspconfig = require('lspconfig')
local configs = require('lspconfig.configs')

configs.basilisk = {
  default_config = {
    cmd = { 'node', '/path/to/qcc-lsp/server/out/server.js', '--stdio' },
    filetypes = { 'c' },
    root_dir = lspconfig.util.root_pattern('.git', 'Makefile'),
  },
}

lspconfig.basilisk.setup{}
```

If you installed the CLI via GitHub Packages, the server entrypoint lives under:

```text
<npm-global-root>/@vatsalsy/qcc-lsp/server/out/server.js
```

**Emacs (with lsp-mode):**

```elisp
(require 'lsp-mode)

(lsp-register-client
 (make-lsp-client
  :new-connection (lsp-stdio-connection '("node" "/path/to/qcc-lsp/server/out/server.js" "--stdio"))
  :major-modes '(c-mode)
  :server-id 'basilisk-ls))
```

### Warning about .c/.h association

This extension associates `.c` and `.h` files with the Basilisk language by default. If you install this extension, you are opting into that behavior. To avoid conflicts with other C/C++ tooling:

- Switch file associations back to `c`/`cpp` in your editor, or
- Set `basilisk.clangd.mode` to `augment` and run a separate clangd extension/client for core C/C++ features.

## Configuration

### VS Code Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `basilisk.qccPath` | string | `"qcc"` | Path to the qcc compiler |
| `basilisk.qcc.includePaths` | string[] | `[]` | Additional include paths for qcc diagnostics (relative to workspace root) |
| `basilisk.basiliskPath` | string | `""` | Path to Basilisk installation (BASILISK env var) |
| `basilisk.enableDiagnostics` | boolean | `true` | Enable compilation diagnostics |
| `basilisk.diagnosticsOnSave` | boolean | `true` | Run diagnostics on file save |
| `basilisk.diagnosticsOnType` | boolean | `false` | Run diagnostics while typing |
| `basilisk.maxNumberOfProblems` | number | `100` | Maximum problems reported per file |
| `basilisk.clangd.enabled` | boolean | `true` | Enable clangd integration |
| `basilisk.clangd.mode` | string | `"proxy"` | `proxy` uses clangd for core semantics; `augment` disables core providers so external clangd can be used; `disabled` turns off clangd |
| `basilisk.clangd.path` | string | `"clangd"` | Path to clangd |
| `basilisk.clangd.args` | string[] | `[]` | Extra clangd command-line args |
| `basilisk.clangd.compileCommandsDir` | string | `""` | Directory containing compile_commands.json (defaults to BASILISK env or inferred qcc root when unset) |
| `basilisk.clangd.fallbackFlags` | string[] | `[]` | Fallback compiler flags (BASILISK include paths are auto-added when available) |
| `basilisk.clangd.diagnosticsMode` | string | `"filtered"` | clangd diagnostics: `all` (no filtering), `filtered` (suppress Basilisk DSL noise), `none` (disable clangd diagnostics) |
| `basilisk.trace.server` | string | `"off"` | LSP trace level |

Example `settings.json`:

```json
{
  "basilisk.qccPath": "/usr/local/bin/qcc",
  "basilisk.basiliskPath": "/home/user/basilisk/src",
  "basilisk.qcc.includePaths": ["src-local"],
  "basilisk.enableDiagnostics": true,
  "basilisk.clangd.enabled": true,
  "basilisk.clangd.mode": "proxy"
}
```

### qcc include paths (automatic)

For qcc diagnostics, the server automatically adds:

- `-I <file-directory>` so local headers resolve, and
- `-I <repo-root>/src-local` if a `src-local` directory is found while walking up from the file.

This matches common Basilisk layouts where simulation cases live in `simulationCases/` and custom headers live in `src-local/`.

If you keep headers elsewhere, add them via `basilisk.qcc.includePaths` (VS Code settings) or a `.comphy-basilisk` file (see below).

### Optional project config: `.comphy-basilisk`

If your project stores headers outside `$BASILISK/*` or `REPO_ROOT/src-local`, create a `.comphy-basilisk` file in your repo and list the extra include paths there.
This file is optional; the server works without it. It is a JSON file with keys that mirror the VS Code settings.

Example:

```json
{
  "basiliskPath": "/Users/you/basilisk/src",
  "qcc": {
    "includePaths": [
      "src-local",
      "include",
      "/absolute/path/to/other/headers"
    ]
  }
}
```

Relative paths in `.comphy-basilisk` are resolved from the directory containing the file.

Template: see `.comphy-basilisk.example` in the repo root.

### clangd configuration (recommended)

clangd works best with compile flags, but you do not need to create `compile_commands.json` just to use this server.

Default behavior (policy B):

- Uses the `BASILISK` environment variable (if set) to add Basilisk include paths.
- If `BASILISK` is not set, it tries to infer the Basilisk root from `qcc` on your PATH.
- If neither is available, clangd runs with its default checks.
- clangd is only used as a fallback when qcc is unavailable (or disabled).
- If clangd is enabled but not installed, the server reports an error when it needs to fall back.

If you already have a `compile_commands.json`, set `basilisk.clangd.compileCommandsDir` to its directory. You can also add extra flags via `basilisk.clangd.fallbackFlags`.

## Usage

### Code Completion

Type to trigger completion suggestions. Special triggers:

- `.` after a vector field for component access (`.x`, `.y`, `.z`)
- `#` for preprocessor directives
- `"` or `<` in `#include` for header suggestions

### Snippets

Type a prefix and press Tab to expand:

| Prefix | Description |
|--------|-------------|
| `foreach` | Basic foreach loop |
| `foreach_face` | Face iteration loop |
| `event` | Event block |
| `event_init` | Initialization event |
| `event_adapt` | Adaptive refinement event |
| `scalar` | Scalar field declaration |
| `vector` | Vector field declaration |
| `main` | Main function template |
| `basilisk_template` | Complete simulation template |

### Commands

- **Basilisk: Compile Current File** - Compile with qcc
- **Basilisk: Compile and Run** - Compile and execute
- **Basilisk: Insert Event Block** - Interactive event insertion
- **Basilisk: Insert Foreach Loop** - Interactive loop insertion

### CLI diagnostics

You can run diagnostics from the command line once the project is built:

```bash
# From the repo
npm run compile
node server/out/cli.js check path/to/file.c

# If installed as a bin
npm link
qcc-lsp check path/to/file.c
```

Note: clangd runs only when qcc is unavailable.

Health check:

```bash
qcc-lsp doctor
```

Common CLI flags:

- `--qcc-include <dir>` (repeatable) add extra include paths
- `--qcc-path <path>`
- `--basilisk-path <path>`
- `--project-config <path>` use a specific `.comphy-basilisk` file

The CLI also reads `.comphy-basilisk` if present (searched upward from the file directory).
Relative `--qcc-include` paths are resolved from the current working directory.

Header-only checks:

Some Basilisk headers are not valid translation units by themselves (they assume other core headers/macros or qcc preprocessing). For header diagnostics, wrap them in a temporary translation unit:

```bash
qcc-lsp check basilisk/src/compressible/two-phase.h --wrap-header --wrap-include "navier-stokes/centered.h"
```

If you omit `--wrap-include`, the CLI defaults to `#include "run.h"`, but some headers require more context.
The wrapper is only applied to qcc diagnostics; clangd (when used) analyzes the original file contents.

Common flags:

- `--no-clangd` to skip clangd
- `--qcc-path /path/to/qcc`
- `--basilisk-path /path/to/basilisk/src`
- `--compile-commands-dir /path/to/compile_commands`
- `--fallback-flag "-I/path/to/include"` (repeatable)
- `--clangd-diagnostics all|filtered|none`
- `--json` for JSON output

## Basilisk C Language Reference

### Field Types

```c
scalar f[];           // Cell-centered scalar
vector u[];           // Cell-centered vector (u.x, u.y, u.z)
face vector uf[];     // Face-centered vector
vertex scalar psi[];  // Vertex-centered scalar
tensor T[];           // Tensor field
```

### Foreach Loops

```c
foreach()             // All cells
foreach_face(x)       // X-direction faces
foreach_vertex()      // All vertices
foreach_boundary(left) // Left boundary cells
foreach_dimension()   // Replicate for each dimension
foreach_level(n)      // Cells at level n
foreach_leaf()        // Leaf cells (finest level)
```

### Events

```c
event init (i = 0) { }        // At iteration 0
event output (t += 0.1) { }   // Every 0.1 time units
event adapt (i++) { }         // Every iteration
event end (t = 10) { }        // At t = 10
```

### Boundary Conditions

```c
f[left] = dirichlet(0);   // Fixed value
f[right] = neumann(0);    // Fixed gradient
```

## Development

### Project Structure

```
qcc-lsp/
├── server/                 # LSP server
│   └── src/
│       ├── server.ts       # Main server entry
│       ├── basiliskLanguage.ts  # Language definitions
│       ├── diagnostics.ts  # Compiler integration
│       └── symbols.ts      # Symbol extraction
├── client/                 # VS Code client
│   └── src/
│       └── extension.ts    # Extension entry
├── syntaxes/               # TextMate grammars
│   └── basilisk.tmLanguage.json
├── snippets/               # Code snippets
│   └── basilisk.json
├── basilisk/               # Basilisk source (reference)
│   └── src/
└── package.json            # Extension manifest
```

### Running Tests

```bash
npm test
```

### Building

```bash
npm run compile           # Build both server and client
npm run compile:server    # Build server only
npm run compile:client    # Build client only
npm run watch             # Watch mode for development
```

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- [Basilisk](http://basilisk.fr/) by Stéphane Popinet
- [basilisk-mode.el](http://basilisk.fr/src/basilisk-mode.el) for Emacs
- [basilisk_setup.el](https://github.com/AdityasOcean/basilisk_setup.el) by Arun K Eswara

## Links

- [Basilisk Website](http://basilisk.fr/)
- [Basilisk Documentation](http://basilisk.fr/src/README)
- [Basilisk Examples](http://basilisk.fr/src/examples/)
- [Basilisk Tutorial](http://basilisk.fr/Tutorial)
