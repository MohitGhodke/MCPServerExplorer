import * as vscode from 'vscode';
import { ServerTreeProvider } from './serverTreeProvider';
import { UsageTracker } from './usageTracker';

/**
 * A Language Model Tool that exposes MCP server status to other Copilot
 * agents and chat participants. Any agent can call this tool to discover
 * what MCP servers the user has, which are active, and what tools they expose.
 */
export class ServerStatusTool implements vscode.LanguageModelTool<Record<string, never>> {

  constructor(
    private serverTreeProvider: ServerTreeProvider,
    private usageTracker: UsageTracker,
  ) {}

  async invoke(
    _options: vscode.LanguageModelToolInvocationOptions<Record<string, never>>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    await this.serverTreeProvider.reload();
    const servers = this.serverTreeProvider.getAllServers();
    const lmAvailable = this.usageTracker.isLmApiAvailable();

    const serverList = servers.map(s => {
      const record = this.usageTracker.getRecord(s.name);
      const liveTools = lmAvailable ? this.usageTracker.getLiveToolCount(s.name) : undefined;
      return {
        name: s.name,
        type: s.serverType,
        scope: s.scope,
        stopped: s.stopped ?? false,
        liveToolCount: liveTools,
        activationCount: record?.activationCount ?? 0,
        maxToolCount: record?.maxToolCount ?? 0,
        lastActiveAt: record?.lastActiveAt ?? null,
        config: {
          command: s.config.command,
          args: s.config.args,
          url: s.config.url,
        },
      };
    });

    const summary = {
      totalServers: servers.length,
      activeServers: lmAvailable
        ? this.usageTracker.getActiveServerNames(servers.map(s => s.name)).length
        : undefined,
      totalLiveTools: lmAvailable ? this.usageTracker.getTotalLiveTools() : undefined,
      servers: serverList,
    };

    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(JSON.stringify(summary, null, 2)),
    ]);
  }

  async prepareInvocation(
    _options: vscode.LanguageModelToolInvocationPrepareOptions<Record<string, never>>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.PreparedToolInvocation> {
    return {
      invocationMessage: 'Fetching MCP server status...',
    };
  }
}
