/**
 * Basilisk C Language Client Extension
 *
 * This is the VS Code extension client that connects to the
 * Basilisk C Language Server.
 */

import * as path from 'path';
import { randomUUID } from 'crypto';
import { compilerInvocation, resolveCompiler } from './compilePlan';
import * as vscode from 'vscode';

import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind
} from 'vscode-languageclient/node';

let client: LanguageClient;

/**
 * Activates the Basilisk C Language Server extension.
 *
 * Starts the language server, registers commands, and configures client options.
 *
 * @param context - VS Code extension context
 */
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

/**
 * Deactivates the extension and stops the language server.
 *
 * @returns Promise that resolves when the server stops, or undefined if no client
 */
export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}

async function runProcessTask(label: string, executable: string, args: string[], cwd: string, folder?: vscode.WorkspaceFolder): Promise<number | undefined> {
  const id = randomUUID();
  const task = new vscode.Task(
    { type: 'basilisk-process', id },
    folder ?? vscode.TaskScope.Global,
    label,
    'Basilisk',
    new vscode.ProcessExecution(executable, args, { cwd })
  );
  task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, panel: vscode.TaskPanelKind.Dedicated };

  return new Promise((resolve, reject) => {
    const listener = vscode.tasks.onDidEndTaskProcess(event => {
      if (event.execution.task.definition.id === id) {
        listener.dispose();
        resolve(event.exitCode);
      }
    });
    void vscode.tasks.executeTask(task).then(undefined, error => {
      listener.dispose();
      reject(error);
    });
  });
}

async function compileActiveFile(run: boolean): Promise<void> {
  if (!vscode.workspace.isTrusted) {
    void vscode.window.showErrorMessage('Trust this workspace before compiling or running a Basilisk file.');
    return;
  }
  const document = vscode.window.activeTextEditor?.document;
  if (!document || document.uri.scheme !== 'file' || !['basilisk', 'c'].includes(document.languageId)) {
    void vscode.window.showErrorMessage('Open a local Basilisk C file to compile.');
    return;
  }
  try {
    const setting = vscode.workspace.getConfiguration('basilisk').inspect<string>('qccPath');
    const executable = resolveCompiler(setting?.globalValue ?? setting?.defaultValue ?? 'qcc');
    if (!executable) {
      throw new Error('Set basilisk.qccPath in User or remote settings to an absolute qcc executable or a command on PATH.');
    }
    const plan = compilerInvocation(executable, document.fileName);
    if (!await document.save()) {
      throw new Error('Save the active file before compiling.');
    }
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    const exitCode = await runProcessTask('Compile', plan.executable, plan.args, plan.cwd, folder);
    if (run && exitCode === 0 && vscode.workspace.isTrusted) {
      await runProcessTask('Run', plan.outputPath, [], plan.cwd, folder);
    }
  } catch (error) {
    void vscode.window.showErrorMessage('Basilisk: ' + (error as Error).message);
  }
}

/**
 * Registers VS Code commands for Basilisk C operations.
 *
 * Registers compile, compile-and-run, insert-event, insert-foreach, and documentation commands.
 *
 * @param context - VS Code extension context for subscriptions
 */
function registerCommands(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('basilisk.compile', () => compileActiveFile(false)),
    vscode.commands.registerCommand('basilisk.compileAndRun', () => compileActiveFile(true))
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
