import * as vscode from 'vscode';
import { McpConfigManager } from './mcpConfigManager';
import { McpScope, McpServerConfig, McpServerNode, McpTreeNode } from './models';
import { ServerTreeProvider } from './serverTreeProvider';
import { SummaryTreeProvider } from './summaryTreeProvider';
import { ImportExportManager } from './importExportManager';
import { UsageTracker } from './usageTracker';
import { ServerLifecycleManager } from './serverLifecycleManager';
import { ChatParticipant } from './chatParticipant';
import { ServerStatusTool } from './serverStatusTool';

export function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel('MCP Server Explorer');

  const configManager = new McpConfigManager(context, outputChannel);
  const usageTracker = new UsageTracker(context);
  const lifecycleManager = new ServerLifecycleManager(configManager);
  const serverTreeProvider = new ServerTreeProvider(configManager);
  const summaryTreeProvider = new SummaryTreeProvider(serverTreeProvider, usageTracker);
  const importExportManager = new ImportExportManager(configManager);

  // ── Copilot integration ─────────────────────────────────────

  const chatParticipant = new ChatParticipant(configManager, serverTreeProvider, usageTracker);
  const serverStatusTool = new ServerStatusTool(serverTreeProvider, usageTracker);

  // ── Tree views ──────────────────────────────────────────────

  const serversView = vscode.window.createTreeView('mcpServerExplorerServersView', {
    treeDataProvider: serverTreeProvider,
    showCollapseAll: true,
  });

  const summaryView = vscode.window.createTreeView('mcpServerExplorerSummaryView', {
    treeDataProvider: summaryTreeProvider,
  });

  // ── Initial load ────────────────────────────────────────────

  serverTreeProvider.reload().then(() => {
    const names = serverTreeProvider.getAllServers().map(s => s.name);
    usageTracker.ensureServers(names);
  }).catch((err) => {
    outputChannel.appendLine(`[MCP Server Explorer] Initial load failed: ${err?.message || err}`);
  });

  // Keep usage tracker in sync whenever server config changes
  serverTreeProvider.onDidChangeTreeData(() => {
    const names = serverTreeProvider.getAllServers().map(s => s.name);
    usageTracker.ensureServers(names);
  });

  // ── Commands ────────────────────────────────────────────────

  context.subscriptions.push(
    serversView,
    summaryView,
    outputChannel,
    configManager,
    usageTracker,
    lifecycleManager,
    serverTreeProvider,
    summaryTreeProvider,
    chatParticipant,
    vscode.lm.registerTool('mcpServerExplorer_getServerStatus', serverStatusTool),

    // Chat participant helper: add server from chat button
    vscode.commands.registerCommand('mcpServerExplorer.chatAddServer', async (
      scope: McpScope, name: string, config: McpServerConfig,
    ) => {
      try {
        await configManager.addServer(scope, name, config);
        vscode.window.showInformationMessage(`MCP Server Explorer: Added "${name}" to ${scope} config.`);
      } catch (err: any) {
        vscode.window.showErrorMessage(`MCP Server Explorer: ${err?.message || 'Failed to add server.'}`);
      }
    }),

    vscode.commands.registerCommand('mcpServerExplorer.refresh', () => {
      serverTreeProvider.reload();
    }),

    vscode.commands.registerCommand('mcpServerExplorer.refreshSummary', () => {
      summaryTreeProvider.refresh();
    }),

    vscode.commands.registerCommand('mcpServerExplorer.resetStats', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Reset all MCP server activity statistics? This cannot be undone.',
        { modal: true },
        'Reset',
      );
      if (confirm !== 'Reset') { return; }
      usageTracker.resetAll();
      vscode.window.showInformationMessage('MCP Server Explorer: Activity statistics reset.');
    }),

    vscode.commands.registerCommand('mcpServerExplorer.addServer', async () => {
      await addServerFlow(configManager, outputChannel);
    }),

    vscode.commands.registerCommand('mcpServerExplorer.removeServer', async (node: McpTreeNode) => {
      if (!node || node.kind !== 'server') { return; }
      const confirm = await vscode.window.showWarningMessage(
        `Remove MCP server "${node.name}" from ${node.scope} config?`,
        { modal: true },
        'Remove',
      );
      if (confirm !== 'Remove') { return; }

      try {
        if (node.stopped) {
          // Server is in disabledServers in mcp.json — delete it from there
          await configManager.removeDisabledServer(node.scope, node.name);
        } else {
          await configManager.removeServer(node.scope, node.name);
        }
        vscode.window.showInformationMessage(`MCP Server Explorer: Removed "${node.name}".`);
      } catch (err: any) {
        vscode.window.showErrorMessage(`MCP Server Explorer: ${err?.message || 'Failed to remove server.'}`);
      }
    }),

    vscode.commands.registerCommand('mcpServerExplorer.restartServer', async (node: McpTreeNode) => {
      if (!node || node.kind !== 'server' || node.stopped) { return; }
      await lifecycleManager.restart(node.scope, node.name, node.config);
    }),

    vscode.commands.registerCommand('mcpServerExplorer.stopServer', async (node: McpTreeNode) => {
      if (!node || node.kind !== 'server' || node.stopped) { return; }
      const confirm = await vscode.window.showWarningMessage(
        `Stop "${node.name}"? It will be removed from the active config but can be resumed later.`,
        { modal: true },
        'Stop',
      );
      if (confirm !== 'Stop') { return; }
      await lifecycleManager.stop(node.scope, node.name, node.config);
    }),

    vscode.commands.registerCommand('mcpServerExplorer.startServer', async (node: McpTreeNode) => {
      if (!node || node.kind !== 'server' || !node.stopped) { return; }
      await lifecycleManager.start(node.scope, node.name);
    }),

    vscode.commands.registerCommand('mcpServerExplorer.editServer', async (node: McpTreeNode) => {
      if (!node || node.kind !== 'server') { return; }
      await openConfigAtServer(configManager, node);
    }),

    vscode.commands.registerCommand('mcpServerExplorer.openUserConfig', async () => {
      const configPath = configManager.getUserConfigPath();
      if (!configPath) {
        vscode.window.showErrorMessage('MCP Server Explorer: Could not resolve user config path.');
        return;
      }
      await ensureFileExists(configPath);
      await vscode.window.showTextDocument(vscode.Uri.file(configPath));
    }),

    vscode.commands.registerCommand('mcpServerExplorer.openWorkspaceConfig', async () => {
      const configPath = configManager.getWorkspaceConfigPath();
      if (!configPath) {
        vscode.window.showErrorMessage('MCP Server Explorer: No workspace folder is open.');
        return;
      }
      await ensureFileExists(configPath);
      await vscode.window.showTextDocument(vscode.Uri.file(configPath));
    }),

    vscode.commands.registerCommand('mcpServerExplorer.importServers', async () => {
      await importExportManager.importServers();
    }),

    vscode.commands.registerCommand('mcpServerExplorer.exportAllServers', async () => {
      await importExportManager.exportAll();
    }),

    vscode.commands.registerCommand('mcpServerExplorer.exportServer', async (node: McpTreeNode) => {
      if (!node || node.kind !== 'server') { return; }
      await importExportManager.exportSingle(node.name, node.config);
    }),

    vscode.commands.registerCommand('mcpServerExplorer.copyServerConfig', async (node: McpTreeNode) => {
      if (!node || node.kind !== 'server') { return; }
      await importExportManager.copyToClipboard(node.name, node.config);
    }),
  );

  outputChannel.appendLine('[MCP Server Explorer] Extension activated.');
}

export function deactivate() {}

// ── Add Server Flow ─────────────────────────────────────────

async function addServerFlow(
  configManager: McpConfigManager,
  outputChannel: vscode.OutputChannel,
): Promise<void> {
  // Step 0: Choose method — manual or Copilot
  const method = await vscode.window.showQuickPick(
    [
      { label: '$(sparkle) Describe with Copilot', description: 'Describe what you need in plain English', id: 'copilot' },
      { label: '$(list-unordered) Manual Configuration', description: 'Step-by-step guided flow', id: 'manual' },
    ],
    { placeHolder: 'How would you like to add a server?' },
  );
  if (!method) { return; }

  if (method.id === 'copilot') {
    return addServerWithCopilot(configManager, outputChannel);
  }

  // Step 1: Choose scope
  const scopeChoice = await vscode.window.showQuickPick(
    [
      { label: 'User Profile', description: 'Available across all workspaces', scope: 'user' as McpScope },
      { label: 'Workspace', description: 'Available only in this workspace', scope: 'workspace' as McpScope },
    ],
    { placeHolder: 'Where should the server be added?' },
  );
  if (!scopeChoice) { return; }

  // Step 2: Choose type
  const typeChoice = await vscode.window.showQuickPick(
    [
      { label: 'stdio', description: 'Local server via command (most common)' },
      { label: 'http', description: 'Remote server via HTTP URL' },
      { label: 'sse', description: 'Remote server via Server-Sent Events' },
    ],
    { placeHolder: 'What type of MCP server?' },
  );
  if (!typeChoice) { return; }

  // Step 3: Server name
  const existingConfig = await configManager.readConfig(scopeChoice.scope);
  const existingNames = Object.keys(existingConfig.servers ?? {});

  const name = await vscode.window.showInputBox({
    prompt: 'Enter a unique name for this MCP server',
    placeHolder: 'e.g., github, playwright, myServer',
    validateInput: (value) => {
      if (!value.trim()) { return 'Name cannot be empty'; }
      if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(value)) {
        return 'Use camelCase or alphanumeric characters (start with a letter)';
      }
      if (existingNames.includes(value)) {
        return `"${value}" already exists in ${scopeChoice.scope} config`;
      }
      return undefined;
    },
  });
  if (!name) { return; }

  // Step 4: Type-specific configuration
  const config: McpServerConfig = { type: typeChoice.label as McpServerConfig['type'] };

  if (typeChoice.label === 'stdio') {
    const command = await vscode.window.showInputBox({
      prompt: 'Enter the command to start the server',
      placeHolder: 'e.g., npx, node, python, docker',
    });
    if (!command) { return; }
    config.command = command;

    const argsInput = await vscode.window.showInputBox({
      prompt: 'Enter command arguments (space-separated, or leave empty)',
      placeHolder: 'e.g., -y @microsoft/mcp-server-playwright',
    });
    if (argsInput && argsInput.trim()) {
      config.args = argsInput.trim().split(/\s+/);
    }
  } else {
    // http or sse
    const url = await vscode.window.showInputBox({
      prompt: 'Enter the server URL',
      placeHolder: 'e.g., https://api.example.com/mcp',
      validateInput: (value) => {
        if (!value.trim()) { return 'URL cannot be empty'; }
        try {
          new URL(value);
        } catch {
          return 'Enter a valid URL';
        }
        return undefined;
      },
    });
    if (!url) { return; }
    config.url = url;
  }

  // Step 5: Write to config
  try {
    await configManager.addServer(scopeChoice.scope, name, config);
    vscode.window.showInformationMessage(`MCP Server Explorer: Added "${name}" to ${scopeChoice.scope} config.`);
  } catch (err: any) {
    outputChannel.appendLine(`[MCP Server Explorer] Failed to add server: ${err?.message || err}`);
    vscode.window.showErrorMessage(`MCP Server Explorer: ${err?.message || 'Failed to add server.'}`);
  }
}

// ── Add Server with Copilot ─────────────────────────────────

async function addServerWithCopilot(
  configManager: McpConfigManager,
  outputChannel: vscode.OutputChannel,
): Promise<void> {
  const description = await vscode.window.showInputBox({
    prompt: 'Describe the MCP server you want to add',
    placeHolder: 'e.g., "Playwright for browser testing" or "a Python server running server.py"',
  });
  if (!description?.trim()) { return; }

  const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
  if (models.length === 0) {
    vscode.window.showErrorMessage('MCP Server Explorer: Copilot model not available. Please ensure GitHub Copilot is active.');
    return;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'MCP Server Explorer: Generating config…' },
    async () => {
      const messages = [
        vscode.LanguageModelChatMessage.User(
          `You generate MCP server configurations for VS Code.\n\n` +
          `The user wants: ${description}\n\n` +
          `Respond with ONLY a JSON object in this exact format (no markdown, no explanation):\n` +
          `{\n` +
          `  "name": "server-name",\n` +
          `  "scope": "user",\n` +
          `  "config": {\n` +
          `    "type": "stdio|http|sse",\n` +
          `    "command": "...",\n` +
          `    "args": ["..."],\n` +
          `    "url": "...",\n` +
          `    "env": {}\n` +
          `  }\n` +
          `}\n\n` +
          `Rules:\n` +
          `- "scope" should be "user" for general-purpose servers, "workspace" for project-specific ones\n` +
          `- Only include fields relevant to the type (stdio needs command/args, http/sse needs url)\n` +
          `- Use "npx" with "-y" flag for npm-based servers\n` +
          `- Use real, well-known MCP server packages when possible\n`,
        ),
      ];

      try {
        const response = await models[0].sendRequest(messages, {}, new vscode.CancellationTokenSource().token);
        let responseText = '';
        for await (const fragment of response.text) {
          responseText += fragment;
        }

        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          vscode.window.showErrorMessage('MCP Server Explorer: Could not generate valid config. Try the manual flow instead.');
          return;
        }

        const parsed = JSON.parse(jsonMatch[0]);
        if (!parsed.name || !parsed.config) {
          vscode.window.showErrorMessage('MCP Server Explorer: Generated config was incomplete. Try again.');
          return;
        }

        const scope: McpScope = parsed.scope === 'workspace' ? 'workspace' : 'user';
        const configPreview = JSON.stringify(parsed.config, null, 2);

        const accept = await vscode.window.showInformationMessage(
          `Add "${parsed.name}" (${parsed.config.type}) to ${scope} config?\n\n${configPreview}`,
          { modal: true },
          'Add Server',
          'Edit First',
        );

        if (accept === 'Add Server') {
          await configManager.addServer(scope, parsed.name, parsed.config);
          vscode.window.showInformationMessage(`MCP Server Explorer: Added "${parsed.name}" to ${scope} config.`);
        } else if (accept === 'Edit First') {
          // Open the config file so they can edit manually after adding
          await configManager.addServer(scope, parsed.name, parsed.config);
          const filePath = configManager.getConfigPath(scope);
          if (filePath) {
            await vscode.window.showTextDocument(vscode.Uri.file(filePath));
          }
        }
      } catch (err: any) {
        outputChannel.appendLine(`[MCP Server Explorer] Copilot config gen failed: ${err?.message || err}`);
        vscode.window.showErrorMessage('MCP Server Explorer: Failed to generate config. Try the manual flow.');
      }
    },
  );
}

// ── Open config at server position ──────────────────────────

async function openConfigAtServer(
  configManager: McpConfigManager,
  node: McpServerNode,
): Promise<void> {
  const filePath = node.filePath;
  if (!filePath) {
    vscode.window.showErrorMessage('MCP Server Explorer: Config file path not found.');
    return;
  }

  await ensureFileExists(filePath);

  const rawText = await configManager.readRawText(node.scope);
  const doc = await vscode.window.showTextDocument(vscode.Uri.file(filePath));

  if (rawText) {
    const offset = configManager.getServerOffset(rawText, node.name);
    if (offset !== undefined) {
      const position = doc.document.positionAt(offset);
      doc.selection = new vscode.Selection(position, position);
      doc.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
    }
  }
}

// ── Ensure file exists with empty template ──────────────────

async function ensureFileExists(filePath: string): Promise<void> {
  try {
    await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
  } catch {
    const template = '{\n  "servers": {}\n}\n';
    // Ensure parent directory exists
    const path = await import('path');
    const dir = path.dirname(filePath);
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(dir));
    await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), Buffer.from(template, 'utf-8'));
  }
}
