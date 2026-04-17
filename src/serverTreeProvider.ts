import * as vscode from 'vscode';
import {
  McpConfigFile,
  McpScope,
  McpScopeNode,
  McpServerConfig,
  McpServerDetailNode,
  McpServerNode,
  McpServerType,
  McpTreeNode,
} from './models';
import { McpConfigManager } from './mcpConfigManager';

export class ServerTreeProvider implements vscode.TreeDataProvider<McpTreeNode>, vscode.Disposable {

  private _onDidChangeTreeData = new vscode.EventEmitter<McpTreeNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private userConfig: McpConfigFile = { servers: {} };
  private workspaceConfig: McpConfigFile = { servers: {} };
  private disposables: vscode.Disposable[] = [];

  constructor(private configManager: McpConfigManager) {
    this.disposables.push(
      configManager.onDidChangeConfig(() => this.reload()),
    );
  }

  async reload(): Promise<void> {
    this.userConfig = await this.configManager.readConfig('user');
    this.workspaceConfig = await this.configManager.readConfig('workspace');
    this._onDidChangeTreeData.fire();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  // ── Data accessors ──────────────────────────────────────────

  getAllServers(): McpServerNode[] {
    const result: McpServerNode[] = [];
    for (const [name, config] of Object.entries(this.userConfig.servers ?? {})) {
      result.push(this.toServerNode(name, config, 'user'));
    }
    for (const [name, config] of Object.entries(this.workspaceConfig.servers ?? {})) {
      result.push(this.toServerNode(name, config, 'workspace'));
    }
    for (const [name, config] of Object.entries(this.userConfig.disabledServers ?? {})) {
      result.push(this.toServerNode(name, config, 'user', true));
    }
    for (const [name, config] of Object.entries(this.workspaceConfig.disabledServers ?? {})) {
      result.push(this.toServerNode(name, config, 'workspace', true));
    }
    return result;
  }

  getUserServers(): McpServerNode[] {
    const running = Object.entries(this.userConfig.servers ?? {}).map(
      ([name, config]) => this.toServerNode(name, config, 'user'),
    );
    const disabled = Object.entries(this.userConfig.disabledServers ?? {}).map(
      ([name, config]) => this.toServerNode(name, config, 'user', true),
    );
    return [...running, ...disabled];
  }

  getWorkspaceServers(): McpServerNode[] {
    const running = Object.entries(this.workspaceConfig.servers ?? {}).map(
      ([name, config]) => this.toServerNode(name, config, 'workspace'),
    );
    const disabled = Object.entries(this.workspaceConfig.disabledServers ?? {}).map(
      ([name, config]) => this.toServerNode(name, config, 'workspace', true),
    );
    return [...running, ...disabled];
  }

  // ── TreeDataProvider ────────────────────────────────────────

  getTreeItem(element: McpTreeNode): vscode.TreeItem {
    switch (element.kind) {
      case 'scope':
        return this.buildScopeItem(element);
      case 'server':
        return this.buildServerItem(element);
      case 'detail':
        return this.buildDetailItem(element);
    }
  }

  getChildren(element?: McpTreeNode): McpTreeNode[] {
    if (!element) {
      return this.buildRoots();
    }
    if (element.kind === 'scope') {
      return this.buildScopeChildren(element);
    }
    if (element.kind === 'server') {
      return this.buildServerChildren(element);
    }
    return [];
  }

  // ── Build roots ─────────────────────────────────────────────

  private buildRoots(): McpTreeNode[] {
    const userRunning  = Object.keys(this.userConfig.servers ?? {}).length;
    const wsRunning    = Object.keys(this.workspaceConfig.servers ?? {}).length;
    const userDisabled = Object.keys(this.userConfig.disabledServers ?? {}).length;
    const wsDisabled   = Object.keys(this.workspaceConfig.disabledServers ?? {}).length;

    return [
      {
        kind: 'scope',
        scope: 'user',
        label: 'User Profile',
        filePath: this.configManager.getConfigPath('user'),
        serverCount: userRunning + userDisabled,
      },
      {
        kind: 'scope',
        scope: 'workspace',
        label: 'Workspace',
        filePath: this.configManager.getConfigPath('workspace'),
        serverCount: wsRunning + wsDisabled,
      },
    ];
  }

  // ── Build scope children ────────────────────────────────────

  private buildScopeChildren(scope: McpScopeNode): McpTreeNode[] {
    const config = scope.scope === 'user' ? this.userConfig : this.workspaceConfig;
    const running: McpTreeNode[] = Object.entries(config.servers ?? {}).map(
      ([name, serverConfig]) => this.toServerNode(name, serverConfig, scope.scope),
    );
    const disabled: McpTreeNode[] = Object.entries(config.disabledServers ?? {}).map(
      ([name, serverConfig]) => this.toServerNode(name, serverConfig, scope.scope, true),
    );
    return [...running, ...disabled];
  }

  // ── Build server children (detail rows) ─────────────────────

  private buildServerChildren(server: McpServerNode): McpTreeNode[] {
    const details: McpServerDetailNode[] = [];
    const c = server.config;

    if (c.command) {
      const cmdLine = c.args ? `${c.command} ${c.args.join(' ')}` : c.command;
      details.push({ kind: 'detail', label: 'Command', value: cmdLine, parentServer: server });
    }

    if (c.url) {
      details.push({ kind: 'detail', label: 'URL', value: c.url, parentServer: server });
    }

    if (c.env && Object.keys(c.env).length > 0) {
      const envKeys = Object.keys(c.env).join(', ');
      details.push({ kind: 'detail', label: 'Env', value: envKeys, parentServer: server });
    }

    if (c.envFile) {
      details.push({ kind: 'detail', label: 'Env File', value: c.envFile, parentServer: server });
    }

    if (c.headers && Object.keys(c.headers).length > 0) {
      const headerKeys = Object.keys(c.headers).join(', ');
      details.push({ kind: 'detail', label: 'Headers', value: headerKeys, parentServer: server });
    }

    if (c.sandboxEnabled) {
      details.push({ kind: 'detail', label: 'Sandbox', value: 'Enabled', parentServer: server });
    }

    if (c.dev) {
      const devInfo = [];
      if (c.dev.watch) { devInfo.push(`watch: ${c.dev.watch}`); }
      if (c.dev.debug) { devInfo.push('debug: true'); }
      details.push({ kind: 'detail', label: 'Dev Mode', value: devInfo.join(', '), parentServer: server });
    }

    return details;
  }

  // ── TreeItem builders ───────────────────────────────────────

  private buildScopeItem(node: McpScopeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      node.label,
      node.serverCount > 0
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed,
    );
    item.description = `${node.serverCount} server${node.serverCount !== 1 ? 's' : ''}`;
    item.iconPath = new vscode.ThemeIcon(
      node.scope === 'user' ? 'account' : 'folder-opened',
    );
    item.contextValue = node.scope === 'user' ? 'scopeUser' : 'scopeWorkspace';
    item.tooltip = node.filePath
      ? `Config: ${node.filePath}`
      : `No config file found for ${node.scope} scope`;
    return item;
  }

  private buildServerItem(node: McpServerNode): vscode.TreeItem {
    const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.Collapsed);

    if (node.stopped) {
      item.description = `${node.serverType} · stopped`;
      item.iconPath = new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('disabledForeground'));
      item.contextValue = `server_${node.serverType}_stopped`;
      item.tooltip = this.buildServerTooltip(node);
      return item;
    }

    // Description: type + short info
    const typeLabel = node.serverType;
    if (node.serverType === 'stdio' && node.config.command) {
      item.description = `${typeLabel} · ${node.config.command}`;
    } else if ((node.serverType === 'http' || node.serverType === 'sse') && node.config.url) {
      item.description = `${typeLabel} · ${node.config.url}`;
    } else {
      item.description = typeLabel;
    }

    // Icon based on server type
    switch (node.serverType) {
      case 'stdio':
        item.iconPath = new vscode.ThemeIcon('terminal');
        break;
      case 'http':
      case 'sse':
        item.iconPath = new vscode.ThemeIcon('globe');
        break;
      default:
        item.iconPath = new vscode.ThemeIcon('server');
    }

    item.contextValue = `server_${node.serverType}`;
    item.tooltip = this.buildServerTooltip(node);
    return item;
  }

  private buildDetailItem(node: McpServerDetailNode): vscode.TreeItem {
    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
    item.description = node.value;
    item.iconPath = new vscode.ThemeIcon('symbol-field');
    item.contextValue = 'detail';
    return item;
  }

  // ── Helpers ─────────────────────────────────────────────────

  private toServerNode(name: string, config: McpServerConfig, scope: McpScope, stopped = false): McpServerNode {
    let serverType: McpServerType = 'stdio';
    if (config.type) {
      serverType = config.type;
    } else if (config.url) {
      serverType = 'http';
    } else if (config.command) {
      serverType = 'stdio';
    }

    return {
      kind: 'server',
      name,
      scope,
      serverType,
      config,
      filePath: this.configManager.getConfigPath(scope),
      stopped: stopped || undefined,
    };
  }

  private buildServerTooltip(node: McpServerNode): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${node.name}**${node.stopped ? ' *(stopped)*' : ''}\n\n`);
    md.appendMarkdown(`- **Type:** ${node.serverType}\n`);
    md.appendMarkdown(`- **Scope:** ${node.scope}\n`);
    if (node.stopped) { md.appendMarkdown(`- **Status:** Stopped (click Start to resume)\n`); }

    if (node.config.command) {
      const cmdLine = node.config.args
        ? `${node.config.command} ${node.config.args.join(' ')}`
        : node.config.command;
      md.appendMarkdown(`- **Command:** \`${cmdLine}\`\n`);
    }
    if (node.config.url) {
      md.appendMarkdown(`- **URL:** ${node.config.url}\n`);
    }
    if (node.config.sandboxEnabled) {
      md.appendMarkdown(`- **Sandbox:** Enabled\n`);
    }

    return md;
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
    this.disposables.forEach(d => d.dispose());
  }
}
