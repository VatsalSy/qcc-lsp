# Contributing to Basilisk C LSP

Thank you for your interest in contributing to the Basilisk C Language Server!

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/qcc-lsp.git`
3. Install dependencies: `npm install`
4. Create a branch: `git checkout -b feature/your-feature`

## Development Setup

### Prerequisites

- Node.js v18 or later
- VS Code (for extension development)
- Basilisk installation (for testing diagnostics)

### Building

```bash
npm run compile    # Build everything
npm run watch      # Watch mode for development
```

### Testing

```bash
npm test           # Run all tests
```

### Debugging

1. Open the project in VS Code
2. Press F5 to launch the Extension Development Host
3. Open a Basilisk C file to test features

## Code Style

- Use TypeScript for all new code
- Follow existing code formatting
- Add JSDoc comments for public APIs
- Keep functions focused and small

## Pull Request Process

1. Ensure your code builds without errors
2. Add tests for new features
3. Update documentation as needed
4. Create a descriptive PR title and description
5. Link any related issues

## Areas for Contribution

### High Priority

- Improve diagnostic messages
- Add more hover documentation for Basilisk functions
- Implement go-to-definition for Basilisk headers
- Add support for Basilisk-specific refactoring

### Medium Priority

- Improve semantic highlighting
- Add code actions (quick fixes)
- Implement signature help for functions
- Add folding ranges for events and foreach blocks

### Low Priority

- Add support for literate programming (.lp files)
- Implement code formatting
- Add debugging support

## Reporting Issues

When reporting bugs, please include:

- VS Code version
- Extension version
- Operating system
- Steps to reproduce
- Expected vs actual behavior
- Relevant error messages or logs

## Questions?

Feel free to open an issue for questions or discussion.
