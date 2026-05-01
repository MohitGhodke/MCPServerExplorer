import * as vscode from 'vscode';
import { McpConfigManager } from './mcpConfigManager';
import { ServerTreeProvider } from './serverTreeProvider';
import { UsageTracker } from './usageTracker';
import { McpScope, McpServerConfig, McpServerNode } from './models';

const PARTICIPANT_ID = 'mcp-server-explorer.chat';

export class ChatParticipant implements vscode.Disposable {

  private participant: vscode.ChatParticipant;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private configManager: McpConfigManager,
    private serverTreeProvider: ServerTreeProvider,
    private usageTracker: UsageTracker,
  ) {
    this.participant = vscode.chat.createChatParticipant(
      PARTICIPANT_ID,
      (request, context, stream, token) => this.handleRequest(request, context, stream, token),
    );
    this.participant.iconPath = new vscode.ThemeIcon('server');

    this.disposables.push(this.participant);
  }

  // ── Request handler ─────────────────────────────────────────

  private async handleRequest(
    request: vscode.ChatRequest,
    _context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
  ): Promise<void> {
    switch (request.command) {
      case 'list':
        return this.handleList(stream);
      case 'add':
        return this.handleAdd(request, stream, token);
      case 'diagnose':
        return this.handleDiagnose(request, stream, token);
      case 'suggest':
        return this.handleSuggest(stream, token);
      case 'share':
        return this.handleShare(request, stream);
      default:
        return this.handleFreeform(request, stream, token);
    }
  }

  // ── /list ───────────────────────────────────────────────────

  private async handleList(stream: vscode.ChatResponseStream): Promise<void> {
    await this.serverTreeProvider.reload();
    const servers = this.serverTreeProvider.getAllServers();

    if (servers.length === 0) {
      stream.markdown('No MCP servers are configured yet.\n\nUse `/add` to add one, or click the **+** button in the MCP Server Explorer sidebar.');
      return;
    }

    const lmAvailable = this.usageTracker.isLmApiAvailable();

    stream.markdown(`### MCP Servers (${servers.length})\n\n`);
    stream.markdown('| Server | Type | Scope | Status | Tools |\n');
    stream.markdown('|--------|------|-------|--------|-------|\n');

    for (const s of servers) {
      const status = s.stopped ? '⏹ Stopped' : '✅ Running';
      let tools = '—';
      if (lmAvailable && !s.stopped) {
        const count = this.usageTracker.getLiveToolCount(s.name);
        tools = count > 0 ? `${count}` : '0';
      }
      const record = this.usageTracker.getRecord(s.name);
      const activations = record?.activationCount ?? 0;
      stream.markdown(`| **${s.name}** | ${s.serverType} | ${s.scope} | ${status} | ${tools} (${activations} activations) |\n`);
    }

    stream.markdown('\n---\n');
    stream.markdown(`**Total tools registered:** ${this.usageTracker.getTotalLiveTools()}\n`);
  }

  // ── /add ────────────────────────────────────────────────────

  private async handleAdd(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const prompt = request.prompt.trim();
    if (!prompt) {
      stream.markdown(
        'Tell me what MCP server you want to add. For example:\n\n' +
        '- `@mcp-explorer /add playwright` — adds the Playwright MCP server\n' +
        '- `@mcp-explorer /add a custom stdio server called myTool that runs python server.py` \n' +
        '- `@mcp-explorer /add an HTTP server at https://api.example.com/mcp`\n',
      );
      return;
    }

    stream.markdown('Generating server configuration...\n\n');

    const config = await this.generateConfigWithLM(prompt, stream, token);
    if (!config) {
      return;
    }

    stream.markdown('```json\n' + JSON.stringify(config.serverConfig, null, 2) + '\n```\n\n');
    stream.markdown(`**Name:** \`${config.name}\`  \n**Scope:** ${config.scope}\n\n`);
    stream.button({
      title: `Add "${config.name}" to ${config.scope} config`,
      command: 'mcpServerExplorer.chatAddServer',
      arguments: [config.scope, config.name, config.serverConfig],
    });
  }

  // ── /diagnose ───────────────────────────────────────────────

  private async handleDiagnose(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const serverName = request.prompt.trim();
    if (!serverName) {
      stream.markdown(
        'Specify which server to diagnose. For example:\n\n' +
        '`@mcp-explorer /diagnose github`\n',
      );
      return;
    }

    await this.serverTreeProvider.reload();
    const servers = this.serverTreeProvider.getAllServers();
    const server = servers.find(s => s.name.toLowerCase() === serverName.toLowerCase());

    if (!server) {
      const available = servers.map(s => `\`${s.name}\``).join(', ');
      stream.markdown(
        `Server **"${serverName}"** not found.\n\n` +
        (available ? `Available servers: ${available}` : 'No servers configured.'),
      );
      return;
    }

    stream.markdown(`### Diagnosing: ${server.name}\n\n`);

    // 1. Config check
    stream.markdown('**Configuration**\n');
    stream.markdown(`- Type: \`${server.serverType}\`\n`);
    stream.markdown(`- Scope: ${server.scope}\n`);

    if (server.stopped) {
      stream.markdown(`- ⚠️ **Server is stopped** (moved to \`disabledServers\`). Use Start to re-enable.\n\n`);
      stream.button({
        title: `Start "${server.name}"`,
        command: 'mcpServerExplorer.startServer',
        arguments: [server],
      });
      return;
    }

    if (server.serverType === 'stdio') {
      if (server.config.command) {
        stream.markdown(`- Command: \`${server.config.command}${server.config.args ? ' ' + server.config.args.join(' ') : ''}\`\n`);
      } else {
        stream.markdown(`- ❌ **No command specified** — stdio servers require a \`command\` field.\n`);
      }
      if (server.config.env) {
        const envKeys = Object.keys(server.config.env);
        stream.markdown(`- Environment variables: ${envKeys.map(k => `\`${k}\``).join(', ')}\n`);
      }
    } else {
      if (server.config.url) {
        stream.markdown(`- URL: \`${server.config.url}\`\n`);
        try {
          new URL(server.config.url);
          stream.markdown(`- ✅ URL is syntactically valid\n`);
        } catch {
          stream.markdown(`- ❌ **URL is invalid** — check the format.\n`);
        }
      } else {
        stream.markdown(`- ❌ **No URL specified** — ${server.serverType} servers require a \`url\` field.\n`);
      }
    }

    // 2. Tool registration check
    stream.markdown('\n**Tool Registration**\n');
    if (this.usageTracker.isLmApiAvailable()) {
      const liveTools = this.usageTracker.getLiveToolCount(server.name);
      if (liveTools > 0) {
        stream.markdown(`- ✅ **${liveTools} tool${liveTools !== 1 ? 's' : ''} registered** and visible to Copilot\n`);
      } else {
        stream.markdown(`- ⚠️ **No tools detected** — the server may still be starting, or it failed to launch.\n`);
        stream.markdown(`- Check the **Output** panel (⇧⌘U) → select "MCP" for server logs.\n`);
      }
    } else {
      stream.markdown(`- ℹ️ Tool detection requires VS Code 1.100+. Current version cannot show live tool data.\n`);
    }

    // 3. Activity check
    const record = this.usageTracker.getRecord(server.name);
    stream.markdown('\n**Activity History**\n');
    if (record && record.activationCount > 0) {
      stream.markdown(`- Activated ${record.activationCount} time${record.activationCount !== 1 ? 's' : ''}\n`);
      stream.markdown(`- Max tools seen: ${record.maxToolCount}\n`);
      if (record.lastActiveAt) {
        stream.markdown(`- Last active: ${new Date(record.lastActiveAt).toLocaleString()}\n`);
      }
    } else {
      stream.markdown(`- No activations recorded yet. The server may have never successfully started.\n`);
    }

    // 4. LLM-powered analysis
    stream.markdown('\n**Analysis**\n');
    const models = await vscode.lm.selectChatModels({
      vendor: 'copilot',
    });

    if (models.length > 0 && !token.isCancellationRequested) {
      const configJson = JSON.stringify(server.config, null, 2);
      const liveTools = this.usageTracker.getLiveToolCount(server.name);
      const messages = [
        vscode.LanguageModelChatMessage.User(
          `You are a VS Code MCP server diagnostics assistant. Analyze this MCP server configuration and provide actionable suggestions.\n\n` +
          `Server name: ${server.name}\n` +
          `Type: ${server.serverType}\n` +
          `Config:\n\`\`\`json\n${configJson}\n\`\`\`\n` +
          `Currently registered tools: ${liveTools}\n` +
          `Activation count: ${record?.activationCount ?? 0}\n` +
          `Is stopped: ${server.stopped}\n\n` +
          `Provide a brief diagnostic summary: is the config valid? Any issues? Suggestions to fix?`,
        ),
      ];

      try {
        const chatResponse = await models[0].sendRequest(messages, {}, token);
        for await (const fragment of chatResponse.text) {
          stream.markdown(fragment);
        }
      } catch {
        stream.markdown('Could not run LLM analysis (model unavailable).\n');
      }
    }

    stream.markdown('\n\n---\n');
    stream.button({
      title: `Restart "${server.name}"`,
      command: 'mcpServerExplorer.restartServer',
      arguments: [server],
    });
    stream.button({
      title: 'Edit in Config',
      command: 'mcpServerExplorer.editServer',
      arguments: [server],
    });
  }

  // ── /suggest ────────────────────────────────────────────────

  private async handleSuggest(
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
  ): Promise<void> {
    await this.serverTreeProvider.reload();
    const existing = this.serverTreeProvider.getAllServers();
    const existingNames = existing.map(s => s.name.toLowerCase());

    // Gather workspace context
    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    const workspaceInfo: string[] = [];

    for (const folder of workspaceFolders.slice(0, 3)) {
      try {
        const entries = await vscode.workspace.fs.readDirectory(folder.uri);
        const names = entries.map(([n]) => n);
        workspaceInfo.push(`Folder "${folder.name}": ${names.slice(0, 30).join(', ')}`);
      } catch {
        // skip
      }
    }

    const models = await vscode.lm.selectChatModels({
      vendor: 'copilot',
    });

    if (models.length === 0) {
      stream.markdown('Could not access Copilot model for suggestions. Ensure GitHub Copilot is active.\n');
      return;
    }

    const messages = [
      vscode.LanguageModelChatMessage.User(
        `You are an assistant that recommends MCP (Model Context Protocol) servers for a VS Code workspace.\n\n` +
        `The user already has these MCP servers configured: ${existingNames.join(', ') || 'none'}\n\n` +
        `Here is information about their workspace:\n${workspaceInfo.join('\n')}\n\n` +
        `Based on the workspace contents (programming languages, frameworks, tools detected from file names), ` +
        `recommend 3-5 MCP servers they don't already have. For each, provide:\n` +
        `1. Server name\n` +
        `2. What it does (one line)\n` +
        `3. The full JSON config to add it\n\n` +
        `Only recommend well-known, real MCP servers. Format each recommendation clearly with a heading.\n` +
        `Use the format for VS Code mcp.json: { "type": "stdio", "command": "npx", "args": [...] } or { "type": "http", "url": "..." }.`,
      ),
    ];

    try {
      stream.markdown('### Suggested MCP Servers\n\n');
      const chatResponse = await models[0].sendRequest(messages, {}, token);
      for await (const fragment of chatResponse.text) {
        stream.markdown(fragment);
      }
    } catch {
      stream.markdown('Failed to generate suggestions. Ensure Copilot is active and try again.\n');
    }
  }

  // ── /share ──────────────────────────────────────────────────

  private async handleShare(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
  ): Promise<void> {
    const serverName = request.prompt.trim();
    await this.serverTreeProvider.reload();
    const servers = this.serverTreeProvider.getAllServers();

    if (!serverName) {
      // Share all
      if (servers.length === 0) {
        stream.markdown('No MCP servers configured to share.\n');
        return;
      }

      stream.markdown('### MCP Server Configurations\n\n');
      stream.markdown('Add the following to your `.vscode/mcp.json` (workspace) or user `mcp.json`:\n\n');
      stream.markdown('```json\n');

      const allConfigs: Record<string, McpServerConfig> = {};
      for (const s of servers) {
        if (!s.stopped) {
          allConfigs[s.name] = s.config;
        }
      }
      stream.markdown(JSON.stringify({ servers: allConfigs }, null, 2));
      stream.markdown('\n```\n');
      stream.markdown(`\n*${Object.keys(allConfigs).length} server(s) exported.*\n`);
      return;
    }

    // Share specific server
    const server = servers.find(s => s.name.toLowerCase() === serverName.toLowerCase());
    if (!server) {
      stream.markdown(`Server **"${serverName}"** not found.\n`);
      return;
    }

    stream.markdown(`### ${server.name} — MCP Server Config\n\n`);
    stream.markdown(`**Type:** ${server.serverType} · **Scope:** ${server.scope}\n\n`);
    stream.markdown('Add this to your `mcp.json`:\n\n');
    stream.markdown('```json\n');
    stream.markdown(JSON.stringify({ servers: { [server.name]: server.config } }, null, 2));
    stream.markdown('\n```\n');

    if (server.serverType === 'stdio' && server.config.command) {
      stream.markdown(`\n> **Setup:** Make sure \`${server.config.command}\` is installed and available on your PATH.\n`);
    }
    if (server.serverType === 'http' || server.serverType === 'sse') {
      stream.markdown(`\n> **Endpoint:** ${server.config.url}\n`);
    }
  }

  // ── Freeform handler ────────────────────────────────────────

  private async handleFreeform(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
  ): Promise<void> {
    await this.serverTreeProvider.reload();
    const servers = this.serverTreeProvider.getAllServers();

    const serversSummary = servers.map(s => {
      const tools = this.usageTracker.getLiveToolCount(s.name);
      return `${s.name} (${s.serverType}, ${s.scope}, ${s.stopped ? 'stopped' : 'running'}, ${tools} tools)`;
    }).join('\n');

    const models = await vscode.lm.selectChatModels({
      vendor: 'copilot',

    });

    if (models.length === 0) {
      stream.markdown(
        'I can help you manage MCP servers. Try these commands:\n\n' +
        '- `/list` — Show all configured servers\n' +
        '- `/add <description>` — Add a new server\n' +
        '- `/diagnose <name>` — Diagnose a server\n' +
        '- `/suggest` — Get server recommendations\n' +
        '- `/share [name]` — Share server config(s)\n',
      );
      return;
    }

    const messages = [
      vscode.LanguageModelChatMessage.User(
        `You are @mcp-explorer, a VS Code chat participant that helps manage MCP (Model Context Protocol) servers.\n\n` +
        `Current MCP servers:\n${serversSummary || 'None configured'}\n\n` +
        `The user says: ${request.prompt}\n\n` +
        `Help them with their MCP server question. If they want to perform an action, guide them to use the appropriate slash command:\n` +
        `- /list — list all servers\n` +
        `- /add <description> — add a server\n` +
        `- /diagnose <name> — diagnose a server\n` +
        `- /suggest — get recommendations\n` +
        `- /share [name] — share config for clipboard/README\n`,
      ),
    ];

    try {
      const chatResponse = await models[0].sendRequest(messages, {}, token);
      for await (const fragment of chatResponse.text) {
        stream.markdown(fragment);
      }
    } catch {
      stream.markdown('Failed to process your request. Try a specific command like `/list` or `/diagnose`.\n');
    }
  }

  // ── LM config generation ────────────────────────────────────

  private async generateConfigWithLM(
    userPrompt: string,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
  ): Promise<{ name: string; scope: McpScope; serverConfig: McpServerConfig } | undefined> {
    const models = await vscode.lm.selectChatModels({
      vendor: 'copilot',
    });

    if (models.length === 0) {
      stream.markdown('Could not access Copilot model. Ensure GitHub Copilot is active.\n');
      return undefined;
    }

    const messages = [
      vscode.LanguageModelChatMessage.User(
        `You generate MCP server configurations for VS Code.\n\n` +
        `The user wants: ${userPrompt}\n\n` +
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
      const chatResponse = await models[0].sendRequest(messages, {}, token);
      let responseText = '';
      for await (const fragment of chatResponse.text) {
        responseText += fragment;
      }

      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        stream.markdown('Failed to generate a valid configuration. Please try again with more details.\n');
        return undefined;
      }

      const parsed = JSON.parse(jsonMatch[0]);
      if (!parsed.name || !parsed.config) {
        stream.markdown('Generated config is incomplete. Please try again.\n');
        return undefined;
      }

      return {
        name: parsed.name,
        scope: parsed.scope === 'workspace' ? 'workspace' : 'user',
        serverConfig: parsed.config,
      };
    } catch {
      stream.markdown('Failed to generate configuration. Ensure Copilot is active and try again.\n');
      return undefined;
    }
  }

  dispose(): void {
    this.disposables.forEach(d => d.dispose());
  }
}
