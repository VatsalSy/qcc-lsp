/**
 * Basilisk C Language Client Extension
 *
 * This is the VS Code extension client that connects to the
 * Basilisk C Language Server.
 */

import * as path from 'path';
import * as vscode from 'vscode';

import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind
} from 'vscode-languageclient/node';

let client: LanguageClient;

/**
 * Validate and sanitize executable path to prevent command injection
 */
function isValidExecutablePath(execPath: string): boolean {
  // Reject paths with shell metacharacters and traversal attempts
  const dangerousChars = /[;&|`$()<>]/;
  if (dangerousChars.test(execPath)) {
    return false;
  }

  // Reject directory traversal patterns
  if (execPath.includes('..')) {
    return false;
  }

  return true;
}

/**
 * Resolve executable path to absolute path if possible
 */
function resolveExecutablePath(execPath: string): string {
  // If already absolute, return as-is
  if (path.isAbsolute(execPath)) {
    return execPath;
  }
  
  // Otherwise return the original (will be resolved by shell PATH)
  return execPath;
}

export function activate(context: vscode.ExtensionContext) {
  // Path to the server module
  const serverModule = context.asAbsolutePath(
    path.join('server', 'out', 'server.js')
  );

  // Debug options for the server
  const debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };

  // Server options
  const serverOptions: ServerOptions = {
    run: {
      module: serverModule,
      transport: TransportKind.ipc
    },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: debugOptions
    }
  };

  // Client options
  const config = vscode.workspace.getConfiguration('basilisk');
  const clientOptions: LanguageClientOptions = {
    // Register for Basilisk C files
    documentSelector: [
      { scheme: 'file', language: 'basilisk' },
      { scheme: 'file', language: 'c', pattern: '**/*.c' },
      { scheme: 'file', language: 'c', pattern: '**/*.h' }
    ],
    initializationOptions: {
      basilisk: {
        clangd: {
          mode: config.get<string>('clangd.mode', 'proxy')
        }
      }
    },
    synchronize: {
      // Synchronize settings
      configurationSection: 'basilisk',
      // Watch for optional project config
      fileEvents: vscode.workspace.createFileSystemWatcher('**/.comphy-basilisk')
    }
  };

  // Create the language client
  client = new LanguageClient(
    'basiliskLanguageServer',
    'Basilisk C Language Server',
    serverOptions,
    clientOptions
  );

  // Register commands
  registerCommands(context);

  // Start the client
  client.start();

  // Show startup message
  vscode.window.setStatusBarMessage('Basilisk LSP started', 3000);
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}

/**
 * Register extension commands
 */
function registerCommands(context: vscode.ExtensionContext) {
  // Compile current file
  context.subscriptions.push(
    vscode.commands.registerCommand('basilisk.compile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage('No active file to compile');
        return;
      }

      const document = editor.document;
      if (document.languageId !== 'basilisk' && document.languageId !== 'c') {
        vscode.window.showErrorMessage('Current file is not a Basilisk C file');
        return;
      }

      // Save document first
      await document.save();

      // Get settings
      const config = vscode.workspace.getConfiguration('basilisk');
      const qccPath = config.get<string>('qccPath', 'qcc');

      // Validate qccPath
      if (!isValidExecutablePath(qccPath)) {
        vscode.window.showErrorMessage(
          `Invalid qcc path: "${qccPath}". Path contains shell metacharacters or directory traversal. ` +
          'Please check your basilisk.qccPath setting.'
        );
        return;
      }

      const resolvedQccPath = resolveExecutablePath(qccPath);

      // Get output name
      const filePath = document.fileName;
      const outputName = path.basename(filePath, path.extname(filePath));

      // Build command
      const terminal = vscode.window.createTerminal('Basilisk Compile');
      terminal.show();
      terminal.sendText(`${resolvedQccPath} -Wall -O2 "${filePath}" -o "${outputName}" -lm`);
    })
  );

  // Compile and run
  context.subscriptions.push(
    vscode.commands.registerCommand('basilisk.compileAndRun', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage('No active file to compile');
        return;
      }

      const document = editor.document;
      if (document.languageId !== 'basilisk' && document.languageId !== 'c') {
        vscode.window.showErrorMessage('Current file is not a Basilisk C file');
        return;
      }

      await document.save();

      const config = vscode.workspace.getConfiguration('basilisk');
      const qccPath = config.get<string>('qccPath', 'qcc');

      // Validate qccPath
      if (!isValidExecutablePath(qccPath)) {
        vscode.window.showErrorMessage(
          `Invalid qcc path: "${qccPath}". Path contains shell metacharacters or directory traversal. ` +
          'Please check your basilisk.qccPath setting.'
        );
        return;
      }

      const resolvedQccPath = resolveExecutablePath(qccPath);

      const filePath = document.fileName;
      const dirPath = path.dirname(filePath);
      const outputName = path.basename(filePath, path.extname(filePath));

      const terminal = vscode.window.createTerminal('Basilisk Run');
      terminal.show();
      terminal.sendText(`cd "${dirPath}" && ${resolvedQccPath} -Wall -O2 "${filePath}" -o "${outputName}" -lm && ./${outputName}`);
    })
  );

  // Insert event block
  context.subscriptions.push(
    vscode.commands.registerCommand('basilisk.insertEvent', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }

      const eventName = await vscode.window.showInputBox({
        prompt: 'Event name',
        placeHolder: 'init'
      });

      if (!eventName) {
        return;
      }

      const eventCondition = await vscode.window.showQuickPick(
        ['i = 0', 't = 0', 'i++', 't++', 't += 0.1', 'Custom...'],
        { placeHolder: 'Select event condition' }
      );

      if (!eventCondition) {
        return;
      }

      let condition = eventCondition;
      if (eventCondition === 'Custom...') {
        const customCondition = await vscode.window.showInputBox({
          prompt: 'Event condition',
          placeHolder: 't += 0.1; t <= 10'
        });
        if (!customCondition) {
          // User cancelled, don't insert anything
          return;
        }
        condition = customCondition;
      }

      const snippet = new vscode.SnippetString(
        `event ${eventName} (${condition}) {\n\t$0\n}`
      );
      editor.insertSnippet(snippet);
    })
  );

  // Insert foreach loop
  context.subscriptions.push(
    vscode.commands.registerCommand('basilisk.insertForeach', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }

      const loopType = await vscode.window.showQuickPick(
        [
          'foreach() - All cells',
          'foreach_face(x) - X faces',
          'foreach_face(y) - Y faces',
          'foreach_vertex() - All vertices',
          'foreach_boundary(left) - Left boundary',
          'foreach_level(n) - Specific level',
          'foreach_leaf() - Leaf cells'
        ],
        { placeHolder: 'Select foreach type' }
      );

      if (!loopType) {
        return;
      }

      let code = '';
      if (loopType.includes('foreach()')) {
        code = 'foreach() {\n\t$0\n}';
      } else if (loopType.includes('foreach_face(x)')) {
        code = 'foreach_face(x) {\n\t$0\n}';
      } else if (loopType.includes('foreach_face(y)')) {
        code = 'foreach_face(y) {\n\t$0\n}';
      } else if (loopType.includes('foreach_vertex')) {
        code = 'foreach_vertex() {\n\t$0\n}';
      } else if (loopType.includes('foreach_boundary')) {
        code = 'foreach_boundary(${1|left,right,top,bottom|}) {\n\t$0\n}';
      } else if (loopType.includes('foreach_level')) {
        code = 'foreach_level(${1:level}) {\n\t$0\n}';
      } else if (loopType.includes('foreach_leaf')) {
        code = 'foreach_leaf() {\n\t$0\n}';
      }

      const snippet = new vscode.SnippetString(code);
      editor.insertSnippet(snippet);
    })
  );

  // Show documentation
  context.subscriptions.push(
    vscode.commands.registerCommand('basilisk.showDocumentation', () => {
      vscode.env.openExternal(vscode.Uri.parse('http://basilisk.fr/'));
    })
  );
}
