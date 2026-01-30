# Basilisk C Language Server (qcc-lsp)

Language Server Protocol (LSP) implementation for [Basilisk C](http://basilisk.fr/), the domain-specific language for computational fluid dynamics simulations.

## Overview

This project provides a complete Language Server Protocol server for Basilisk C, enabling rich IDE features in any LSP-compatible editor (VS Code, Neovim, Emacs with lsp-mode, etc.).

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

1. **Node.js** (v18 or later)
2. **Basilisk** installation with `qcc` compiler
   - Follow installation at http://basilisk.fr/src/INSTALL

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

1. Build the extension as above
2. Open VS Code and go to Extensions (Ctrl+Shift+X)
3. Click "..." > "Install from VSIX..."
4. Select the generated `.vsix` file

Or for development:

```bash
# Open in VS Code
code .

# Press F5 to launch Extension Development Host
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

**Emacs (with lsp-mode):**

```elisp
(require 'lsp-mode)

(lsp-register-client
 (make-lsp-client
  :new-connection (lsp-stdio-connection '("node" "/path/to/qcc-lsp/server/out/server.js" "--stdio"))
  :major-modes '(c-mode)
  :server-id 'basilisk-ls))
```

## Configuration

### VS Code Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `basilisk.qccPath` | string | `"qcc"` | Path to the qcc compiler |
| `basilisk.basiliskPath` | string | `""` | Path to Basilisk installation (BASILISK env var) |
| `basilisk.enableDiagnostics` | boolean | `true` | Enable compilation diagnostics |
| `basilisk.diagnosticsOnSave` | boolean | `true` | Run diagnostics on file save |
| `basilisk.diagnosticsOnType` | boolean | `false` | Run diagnostics while typing |
| `basilisk.maxNumberOfProblems` | number | `100` | Maximum problems reported per file |
| `basilisk.trace.server` | string | `"off"` | LSP trace level |

Example `settings.json`:

```json
{
  "basilisk.qccPath": "/usr/local/bin/qcc",
  "basilisk.basiliskPath": "/home/user/basilisk/src",
  "basilisk.enableDiagnostics": true
}
```

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
