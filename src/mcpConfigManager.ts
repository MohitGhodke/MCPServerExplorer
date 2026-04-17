import * as vscode from 'vscode';
import * as path from 'path';
import * as jsonc from 'jsonc-parser';
import { McpConfigFile, McpScope, McpServerConfig } from './models';

export class McpConfigManager implements vscode.Disposable {

  private _onDidChangeConfig = new vscode.EventEmitter<void>();
  readonly onDidChangeConfig = this._onDidChangeConfig.event;

  private watchers: vscode.FileSystemWatcher[] = [];
  private disposables: vscode.Disposable[] = [];
  private readonly userDataDir: string;

  constructor(context: vscode.ExtensionContext) {
    // Derive the user data directory from globalStorageUri.
    // globalStorageUri = <userDataDir>/globalStorage/<publisher.ext>
    // Going up two levels gives us the active profile's User directory.
    this.userDataDir = path.dirname(path.dirname(context.globalStorageUri.fsPath));
    this.setupWatchers();
  }

  // ── Public API ──────────────────────────────────────────────

  async readConfig(scope: McpScope): Promise<McpConfigFile> {
    const filePath = this.getConfigPath(scope);
    if (!filePath) { return { servers: {} }; }

    try {
      const uri = vscode.Uri.file(filePath);
      const raw = await vscode.workspace.fs.readFile(uri);
      const text = Buffer.from(raw).toString('utf-8');
      const errors: jsonc.ParseError[] = [];
      const parsed = jsonc.parse(text, errors) as McpConfigFile | undefined;
      if (!parsed) { return { servers: {} }; }
      return { servers: parsed.servers ?? {}, inputs: parsed.inputs, disabledServers: parsed.disabledServers ?? {} };
    } catch {
      return { servers: {} };
    }
  }

  async readRawText(scope: McpScope): Promise<string | undefined> {
    const filePath = this.getConfigPath(scope);
    if (!filePath) { return undefined; }
    try {
      const raw = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
      return Buffer.from(raw).toString('utf-8');
    } catch {
      return undefined;
    }
  }

  async addServer(scope: McpScope, name: string, config: McpServerConfig): Promise<void> {
    const filePath = this.getConfigPath(scope);
    if (!filePath) {
      throw new Error(scope === 'workspace'
        ? 'No workspace folder is open.'
        : 'Could not resolve user config path.');
    }

    let text: string;
    try {
      const raw = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
      text = Buffer.from(raw).toString('utf-8');
    } catch {
      text = '{\n  "servers": {}\n}\n';
    }

    // Ensure "servers" key exists
    const parsed = jsonc.parse(text) as McpConfigFile | undefined;
    if (!parsed?.servers) {
      const edits = jsonc.modify(text, ['servers'], {}, { formattingOptions: { tabSize: 2, insertSpaces: true } });
      text = jsonc.applyEdits(text, edits);
    }

    const edits = jsonc.modify(text, ['servers', name], config, {
      formattingOptions: { tabSize: 2, insertSpaces: true },
    });
    const newText = jsonc.applyEdits(text, edits);

    await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), Buffer.from(newText, 'utf-8'));
    this._onDidChangeConfig.fire();
  }

  async removeServer(scope: McpScope, name: string): Promise<void> {
    const filePath = this.getConfigPath(scope);
    if (!filePath) { return; }

    let text: string;
    try {
      const raw = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
      text = Buffer.from(raw).toString('utf-8');
    } catch {
      return;
    }

    const edits = jsonc.modify(text, ['servers', name], undefined, {
      formattingOptions: { tabSize: 2, insertSpaces: true },
    });
    const newText = jsonc.applyEdits(text, edits);

    await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), Buffer.from(newText, 'utf-8'));
    this._onDidChangeConfig.fire();
  }

  /**
   * Moves a server entry from "servers" to "disabledServers" within the same
   * mcp.json. VS Code will no longer start the server, but the config is
   * preserved in the file and can be re-enabled at any time.
   */
  async disableServer(scope: McpScope, name: string, config: McpServerConfig): Promise<void> {
    const filePath = this.getConfigPath(scope);
    if (!filePath) {
      throw new Error(scope === 'workspace' ? 'No workspace folder is open.' : 'Could not resolve user config path.');
    }

    let text: string;
    try {
      const raw = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
      text = Buffer.from(raw).toString('utf-8');
    } catch {
      text = '{\n  "servers": {}\n}\n';
    }

    // Remove from servers
    const removeEdits = jsonc.modify(text, ['servers', name], undefined, {
      formattingOptions: { tabSize: 2, insertSpaces: true },
    });
    text = jsonc.applyEdits(text, removeEdits);

    // Add to disabledServers
    const addEdits = jsonc.modify(text, ['disabledServers', name], config, {
      formattingOptions: { tabSize: 2, insertSpaces: true },
    });
    text = jsonc.applyEdits(text, addEdits);

    await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), Buffer.from(text, 'utf-8'));
    this._onDidChangeConfig.fire();
  }

  /**
   * Moves a server entry from "disabledServers" back to "servers" so VS Code
   * will start it again. Cleans up the empty disabledServers object if needed.
   */
  async enableServer(scope: McpScope, name: string): Promise<void> {
    const filePath = this.getConfigPath(scope);
    if (!filePath) {
      throw new Error(scope === 'workspace' ? 'No workspace folder is open.' : 'Could not resolve user config path.');
    }

    let text: string;
    try {
      const raw = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
      text = Buffer.from(raw).toString('utf-8');
    } catch {
      throw new Error(`Config file not found for ${scope} scope.`);
    }

    const parsed = jsonc.parse(text) as McpConfigFile | undefined;
    const config = parsed?.disabledServers?.[name];
    if (!config) {
      throw new Error(`"${name}" was not found in disabledServers.`);
    }

    // Add back to servers
    let edits = jsonc.modify(text, ['servers', name], config, {
      formattingOptions: { tabSize: 2, insertSpaces: true },
    });
    text = jsonc.applyEdits(text, edits);

    // Remove from disabledServers
    edits = jsonc.modify(text, ['disabledServers', name], undefined, {
      formattingOptions: { tabSize: 2, insertSpaces: true },
    });
    text = jsonc.applyEdits(text, edits);

    // Clean up empty disabledServers object
    const reparsed = jsonc.parse(text) as McpConfigFile | undefined;
    if (reparsed?.disabledServers && Object.keys(reparsed.disabledServers).length === 0) {
      const cleanEdits = jsonc.modify(text, ['disabledServers'], undefined, {
        formattingOptions: { tabSize: 2, insertSpaces: true },
      });
      text = jsonc.applyEdits(text, cleanEdits);
    }

    await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), Buffer.from(text, 'utf-8'));
    this._onDidChangeConfig.fire();
  }

  /**
   * Permanently removes a server from the "disabledServers" section.
   * Use this when the user wants to fully delete a disabled server.
   */
  async removeDisabledServer(scope: McpScope, name: string): Promise<void> {
    const filePath = this.getConfigPath(scope);
    if (!filePath) { return; }

    let text: string;
    try {
      const raw = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
      text = Buffer.from(raw).toString('utf-8');
    } catch {
      return;
    }

    let edits = jsonc.modify(text, ['disabledServers', name], undefined, {
      formattingOptions: { tabSize: 2, insertSpaces: true },
    });
    text = jsonc.applyEdits(text, edits);

    // Clean up empty disabledServers object
    const reparsed = jsonc.parse(text) as McpConfigFile | undefined;
    if (reparsed?.disabledServers && Object.keys(reparsed.disabledServers).length === 0) {
      const cleanEdits = jsonc.modify(text, ['disabledServers'], undefined, {
        formattingOptions: { tabSize: 2, insertSpaces: true },
      });
      text = jsonc.applyEdits(text, cleanEdits);
    }

    await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), Buffer.from(text, 'utf-8'));
    this._onDidChangeConfig.fire();
  }

  async writeFullConfig(scope: McpScope, servers: Record<string, McpServerConfig>): Promise<void> {
    const filePath = this.getConfigPath(scope);
    if (!filePath) {
      throw new Error(scope === 'workspace'
        ? 'No workspace folder is open.'
        : 'Could not resolve user config path.');
    }

    let text: string;
    try {
      const raw = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
      text = Buffer.from(raw).toString('utf-8');
    } catch {
      text = '{}';
    }

    const edits = jsonc.modify(text, ['servers'], servers, {
      formattingOptions: { tabSize: 2, insertSpaces: true },
    });
    const newText = jsonc.applyEdits(text, edits);

    await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), Buffer.from(newText, 'utf-8'));
    this._onDidChangeConfig.fire();
  }

  /** Get the offset of a server key in the raw text (for opening at the right line). */
  getServerOffset(text: string, serverName: string): number | undefined {
    const tree = jsonc.parseTree(text);
    if (!tree) { return undefined; }
    const serverNode = jsonc.findNodeAtLocation(tree, ['servers', serverName]);
    return serverNode?.offset;
  }

  // ── Config paths ────────────────────────────────────────────

  getConfigPath(scope: McpScope): string | undefined {
    if (scope === 'workspace') {
      return this.getWorkspaceConfigPath();
    }
    return this.getUserConfigPath();
  }

  getUserConfigPath(): string {
    return path.join(this.userDataDir, 'mcp.json');
  }

  getWorkspaceConfigPath(): string | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) { return undefined; }
    return path.join(folders[0].uri.fsPath, '.vscode', 'mcp.json');
  }

  // ── File watchers ───────────────────────────────────────────

  private setupWatchers(): void {
    // Watch workspace mcp.json
    const wsWatcher = vscode.workspace.createFileSystemWatcher('**/.vscode/mcp.json');
    wsWatcher.onDidChange(() => this._onDidChangeConfig.fire());
    wsWatcher.onDidCreate(() => this._onDidChangeConfig.fire());
    wsWatcher.onDidDelete(() => this._onDidChangeConfig.fire());
    this.watchers.push(wsWatcher);

    // Watch user mcp.json
    const userPath = this.getUserConfigPath();
    if (userPath) {
      const userPattern = new vscode.RelativePattern(vscode.Uri.file(path.dirname(userPath)), 'mcp.json');
      const userWatcher = vscode.workspace.createFileSystemWatcher(userPattern);
      userWatcher.onDidChange(() => this._onDidChangeConfig.fire());
      userWatcher.onDidCreate(() => this._onDidChangeConfig.fire());
      userWatcher.onDidDelete(() => this._onDidChangeConfig.fire());
      this.watchers.push(userWatcher);
    }
  }

  dispose(): void {
    this.watchers.forEach(w => w.dispose());
    this._onDidChangeConfig.dispose();
    this.disposables.forEach(d => d.dispose());
  }
}
