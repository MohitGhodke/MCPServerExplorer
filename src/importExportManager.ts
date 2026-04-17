import * as vscode from 'vscode';
import { McpScope, McpServerConfig } from './models';
import { McpConfigManager } from './mcpConfigManager';

export interface ExportPayload {
  /** Schema marker so imports can be validated. */
  mcpServerExplorer: '1.0';
  servers: Record<string, McpServerConfig>;
}

export class ImportExportManager {

  constructor(private configManager: McpConfigManager) {}

  // ── Export ──────────────────────────────────────────────────

  async exportAll(): Promise<void> {
    const userConfig = await this.configManager.readConfig('user');
    const wsConfig = await this.configManager.readConfig('workspace');

    const merged: Record<string, McpServerConfig> = {};
    for (const [name, config] of Object.entries(userConfig.servers ?? {})) {
      merged[name] = config;
    }
    for (const [name, config] of Object.entries(wsConfig.servers ?? {})) {
      merged[name] = config;
    }

    if (Object.keys(merged).length === 0) {
      vscode.window.showInformationMessage('MCP Server Explorer: No servers to export.');
      return;
    }

    await this.saveToFile({ mcpServerExplorer: '1.0', servers: merged });
  }

  async exportSingle(name: string, config: McpServerConfig): Promise<void> {
    await this.saveToFile({
      mcpServerExplorer: '1.0',
      servers: { [name]: config },
    });
  }

  async copyToClipboard(name: string, config: McpServerConfig): Promise<void> {
    const payload: ExportPayload = {
      mcpServerExplorer: '1.0',
      servers: { [name]: config },
    };
    const text = JSON.stringify(payload, null, 2);
    await vscode.env.clipboard.writeText(text);
    vscode.window.showInformationMessage(`MCP Server Explorer: "${name}" config copied to clipboard.`);
  }

  // ── Import ─────────────────────────────────────────────────

  async importServers(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { 'JSON files': ['json'] },
      openLabel: 'Import MCP Servers',
    });

    if (!uris || uris.length === 0) { return; }

    const raw = await vscode.workspace.fs.readFile(uris[0]);
    const text = Buffer.from(raw).toString('utf-8');

    let payload: ExportPayload;
    try {
      payload = JSON.parse(text);
    } catch {
      vscode.window.showErrorMessage('MCP Server Explorer: Invalid JSON file.');
      return;
    }

    if (!payload.servers || typeof payload.servers !== 'object') {
      vscode.window.showErrorMessage('MCP Server Explorer: File does not contain a valid "servers" object.');
      return;
    }

    const serverNames = Object.keys(payload.servers);
    if (serverNames.length === 0) {
      vscode.window.showInformationMessage('MCP Server Explorer: No servers found in import file.');
      return;
    }

    // Ask target scope
    const scopeChoice = await vscode.window.showQuickPick(
      [
        { label: 'User Profile', description: 'Available across all workspaces', scope: 'user' as McpScope },
        { label: 'Workspace', description: 'Available only in this workspace', scope: 'workspace' as McpScope },
      ],
      { placeHolder: 'Where should imported servers be added?' },
    );
    if (!scopeChoice) { return; }

    const existingConfig = await this.configManager.readConfig(scopeChoice.scope);
    const existingServers = existingConfig.servers ?? {};
    let imported = 0;
    let skipped = 0;

    for (const [name, config] of Object.entries(payload.servers)) {
      if (existingServers[name]) {
        const overwrite = await vscode.window.showQuickPick(
          ['Overwrite', 'Skip', 'Rename'],
          { placeHolder: `Server "${name}" already exists. What would you like to do?` },
        );

        if (overwrite === 'Skip') {
          skipped++;
          continue;
        } else if (overwrite === 'Rename') {
          const newName = await vscode.window.showInputBox({
            prompt: `Enter a new name for "${name}"`,
            value: `${name}_imported`,
            validateInput: (v) => {
              if (!v.trim()) { return 'Name cannot be empty'; }
              if (existingServers[v]) { return `"${v}" already exists`; }
              return undefined;
            },
          });
          if (!newName) { skipped++; continue; }
          await this.configManager.addServer(scopeChoice.scope, newName, config);
          imported++;
          continue;
        }
        // Overwrite: fall through to addServer below
      }

      await this.configManager.addServer(scopeChoice.scope, name, config);
      imported++;
    }

    vscode.window.showInformationMessage(
      `MCP Server Explorer: Imported ${imported} server${imported !== 1 ? 's' : ''}` +
      (skipped > 0 ? `, skipped ${skipped}` : '') + '.',
    );
  }

  // ── Helpers ─────────────────────────────────────────────────

  private async saveToFile(payload: ExportPayload): Promise<void> {
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file('mcp-servers-export.json'),
      filters: { 'JSON files': ['json'] },
    });
    if (!uri) { return; }

    const content = JSON.stringify(payload, null, 2);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));
    vscode.window.showInformationMessage(
      `MCP Server Explorer: Exported ${Object.keys(payload.servers).length} server(s) to ${uri.fsPath}`,
    );
  }
}
