import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { Diagnostic, InitializeParams, InitializeResult } from 'vscode-languageserver/node';

export interface ClangdRuntimeConfig {
  path: string;
  args: string[];
  rootUri: string | null;
  workspaceFolders: InitializeParams['workspaceFolders'] | null;
  fallbackFlags: string[];
}

export interface ClangdLogger {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  method: string;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

export class ClangdClient {
  private process: ChildProcessWithoutNullStreams | null = null;
  private buffer: Buffer = Buffer.alloc(0);
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private ready = false;
  private readyPromise: Promise<void> | null = null;
  private queuedNotifications: JsonRpcNotification[] = [];
  private onDiagnosticsCallback: ((uri: string, diagnostics: Diagnostic[]) => void) | null = null;
  private onLogCallback: ((message: string) => void) | null = null;

  constructor(
    private readonly config: ClangdRuntimeConfig,
    private readonly logger: ClangdLogger
  ) {}

  onDiagnostics(callback: (uri: string, diagnostics: Diagnostic[]) => void) {
    this.onDiagnosticsCallback = callback;
  }

  onLog(callback: (message: string) => void) {
    this.onLogCallback = callback;
  }

  isReady(): boolean {
    return this.ready;
  }

  async start(initParams: InitializeParams): Promise<InitializeResult | null> {
    if (this.process) {
      return null;
    }

    try {
      this.process = spawn(this.config.path, this.config.args, {
        stdio: 'pipe'
      });
    } catch (error) {
      this.logger.error(`Failed to start clangd: ${(error as Error).message}`);
      return null;
    }

    this.process.stdout.on('data', (chunk: Buffer) => this.handleData(chunk));
    this.process.stderr.on('data', (chunk: Buffer) => {
      const message = chunk.toString();
      if (this.onLogCallback) {
        this.onLogCallback(message);
      }
    });
    this.process.on('exit', (code, signal) => {
      this.ready = false;
      this.process = null;
      for (const pending of this.pending.values()) {
        pending.reject(new Error('clangd exited'));
      }
      this.pending.clear();
      const reason = signal ? `signal ${signal}` : `code ${code}`;
      this.logger.warn(`clangd exited (${reason})`);
    });

    this.readyPromise = this.initialize(initParams);
    await this.readyPromise;
    return null;
  }

  async stop(): Promise<void> {
    if (!this.process) {
      return;
    }

    try {
      await this.request('shutdown', undefined);
    } catch {
      // Ignore shutdown errors.
    }

    this.notify('exit', undefined);
    this.process.kill();
    this.process = null;
    this.ready = false;
    this.pending.clear();
    this.queuedNotifications = [];
  }

  async request(method: string, params: unknown): Promise<unknown> {
    return this.requestInternal(method, params, false);
  }

  private async requestInternal(method: string, params: unknown, skipReady: boolean): Promise<unknown> {
    if (!this.process) {
      throw new Error('clangd is not running');
    }

    if (!skipReady) {
      if (!this.readyPromise) {
        throw new Error('clangd has not initialized');
      }
      await this.readyPromise;
    }

    const id = this.nextId++;
    const message: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params
    };

    const promise = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
    });

    this.send(message);
    return promise;
  }

  notify(method: string, params: unknown): void {
    const message: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      params
    };

    if (!this.ready) {
      this.queuedNotifications.push(message);
      return;
    }

    this.send(message);
  }

  private async initialize(initParams: InitializeParams): Promise<void> {
    const initializationOptions = {
      fallbackFlags: this.config.fallbackFlags
    };

    const params: InitializeParams = {
      processId: process.pid,
      rootUri: this.config.rootUri,
      workspaceFolders: this.config.workspaceFolders || undefined,
      capabilities: initParams.capabilities,
      initializationOptions
    };

    const result = await this.requestInternal('initialize', params, true).catch((error) => {
      this.logger.error(`clangd initialize failed: ${(error as Error).message}`);
      throw error;
    });

    this.ready = true;
    this.notify('initialized', {});
    this.flushNotifications();

    const initResult = result as InitializeResult | undefined;
    if (initResult && initResult.serverInfo?.name) {
      this.logger.info(`clangd initialized (${initResult.serverInfo.name})`);
    }
  }

  private flushNotifications(): void {
    if (!this.ready || !this.process) {
      return;
    }

    const queued = [...this.queuedNotifications];
    this.queuedNotifications = [];
    for (const notification of queued) {
      this.send(notification);
    }
  }

  private handleData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) {
        return;
      }

      const header = this.buffer.slice(0, headerEnd).toString('ascii');
      const lengthMatch = /Content-Length:\s*(\d+)/i.exec(header);
      if (!lengthMatch) {
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }

      const messageLength = Number.parseInt(lengthMatch[1], 10);
      const totalLength = headerEnd + 4 + messageLength;
      if (this.buffer.length < totalLength) {
        return;
      }

      const body = this.buffer.slice(headerEnd + 4, totalLength).toString('utf8');
      this.buffer = this.buffer.slice(totalLength);

      try {
        const message = JSON.parse(body) as JsonRpcMessage;
        this.handleMessage(message);
      } catch (error) {
        this.logger.error(`Failed to parse clangd message: ${(error as Error).message}`);
      }
    }
  }

  private handleMessage(message: JsonRpcMessage): void {
    if ('method' in message) {
      if ('id' in message) {
        void this.handleServerRequest(message as JsonRpcRequest);
        return;
      }
      this.handleNotification(message as JsonRpcNotification);
      return;
    }

    const response = message as JsonRpcResponse;
    const pending = this.pending.get(response.id);
    if (!pending) {
      return;
    }
    this.pending.delete(response.id);
    if (response.error) {
      pending.reject(new Error(response.error.message));
    } else {
      pending.resolve(response.result);
    }
  }

  private handleNotification(notification: JsonRpcNotification): void {
    switch (notification.method) {
      case 'textDocument/publishDiagnostics': {
        const params = notification.params as { uri: string; diagnostics: Diagnostic[] } | undefined;
        if (params && this.onDiagnosticsCallback) {
          this.onDiagnosticsCallback(params.uri, params.diagnostics || []);
        }
        break;
      }
      case 'window/logMessage':
      case 'window/showMessage': {
        const params = notification.params as { message?: string } | undefined;
        if (params?.message) {
          this.logger.info(params.message);
        }
        break;
      }
      case '$/progress':
      case 'telemetry/event':
        break;
      default:
        break;
    }
  }

  private async handleServerRequest(request: JsonRpcRequest): Promise<void> {
    let result: unknown = null;

    switch (request.method) {
      case 'workspace/configuration': {
        const params = request.params as { items?: unknown[] } | undefined;
        const items = params?.items ?? [];
        result = items.map(() => ({}));
        break;
      }
      case 'client/registerCapability':
      case 'client/unregisterCapability':
      case 'window/workDoneProgress/create':
        result = null;
        break;
      case 'workspace/applyEdit':
        result = { applied: false };
        break;
      default:
        result = null;
        break;
    }

    this.send({
      jsonrpc: '2.0',
      id: request.id,
      result
    } as JsonRpcResponse);
  }

  private send(message: JsonRpcMessage): void {
    if (!this.process) {
      return;
    }

    const payload = JSON.stringify(message);
    const header = `Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n`;
    this.process.stdin.write(header + payload, 'utf8');
  }
}
