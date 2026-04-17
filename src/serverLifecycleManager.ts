import * as vscode from 'vscode';
import { McpConfigManager } from './mcpConfigManager';
import { McpScope, McpServerConfig } from './models';

type LmTool = { name: string };
type LmNamespace = { tools?: LmTool[]; onDidChangeTools?: vscode.Event<void> };

/**
 * Manages MCP server lifecycle: restart, disable (stop), and enable (start).
 *
 * ## How Stop/Start works
 * VS Code does NOT expose a public API to stop or start individual MCP server
 * processes. To avoid removing nodes from mcp.json, we instead move the server
 * entry between "servers" and "disabledServers" within the same file:
 *
 *   { "servers": { "github": {...} }, "disabledServers": { "playwright": {...} } }
 *
 * VS Code only reads "servers", so a disabled server's process is not started.
 * The config is fully preserved in the file — no data is stored in globalState.
 *
 * ## How Restart works
 * VS Code has no public API to restart a running server process. The only
 * mechanism available is a config-file touch: remove the entry then re-add it,
 * triggering VS Code to detect the change and relaunch the server. The gap
 * between removal and re-addition must be long enough for VS Code's file watcher
 * to register them as two separate changes (~1.5 s).
 *
 * ## Feedback
 * After a restart or enable, we poll vscode.lm.tools (and listen to
 * vscode.lm.onDidChangeTools) for up to 60 s. Tools appearing → success
 * notification with a tool count. Timeout → informational message (not a
 * scary warning) since the config write itself succeeded.
 */
export class ServerLifecycleManager implements vscode.Disposable {

  private pendingTimers: ReturnType<typeof setTimeout>[] = [];
  private pendingIntervals: ReturnType<typeof setInterval>[] = [];

  constructor(private configManager: McpConfigManager) {}

  // ── Public API ──────────────────────────────────────────────

  /**
   * Briefly removes then re-adds the server config entry, forcing VS Code to
   * relaunch the server process. The node is absent from mcp.json for ~1.5 s
   * to ensure VS Code's file watcher registers two separate changes.
   */
  async restart(scope: McpScope, name: string, config: McpServerConfig): Promise<void> {
    try {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `MCP Server Explorer: Restarting "${name}"…`, cancellable: false },
        async () => {
          await this.configManager.removeServer(scope, name);
          // 1.5 s gap — must exceed VS Code's file-watcher debounce so the
          // removal and re-addition are processed as two discrete events.
          await delay(1500);
          await this.configManager.addServer(scope, name, config);
        },
      );
      void this.notifyAfterLaunch(name, 'restarted');
    } catch (err: any) {
      vscode.window.showErrorMessage(
        `MCP Server Explorer: Failed to restart "${name}". ${err?.message ?? String(err)}`,
      );
    }
  }

  /**
   * Moves the server from "servers" to "disabledServers" in mcp.json.
   * VS Code will no longer run it, but the full config is preserved in the file.
   */
  async stop(scope: McpScope, name: string, config: McpServerConfig): Promise<void> {
    try {
      await this.configManager.disableServer(scope, name, config);
      vscode.window.showInformationMessage(
        `MCP Server Explorer: "${name}" disabled. Config preserved in mcp.json — use Start to re-enable.`,
      );
    } catch (err: any) {
      vscode.window.showErrorMessage(
        `MCP Server Explorer: Failed to disable "${name}". ${err?.message ?? String(err)}`,
      );
    }
  }

  /**
   * Moves the server from "disabledServers" back to "servers" in mcp.json,
   * causing VS Code to start the server process.
   */
  async start(scope: McpScope, name: string): Promise<void> {
    try {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `MCP Server Explorer: Starting "${name}"…`, cancellable: false },
        async () => {
          await this.configManager.enableServer(scope, name);
        },
      );
      void this.notifyAfterLaunch(name, 'started');
    } catch (err: any) {
      vscode.window.showErrorMessage(
        `MCP Server Explorer: Failed to start "${name}". ${err?.message ?? String(err)}`,
      );
    }
  }

  // ── Post-launch feedback ────────────────────────────────────

  private async notifyAfterLaunch(name: string, action: 'restarted' | 'started'): Promise<void> {
    if (!this.isLmAvailable()) {
      vscode.window.showInformationMessage(`MCP Server Explorer: "${name}" config ${action}. The server should appear shortly.`);
      return;
    }

    const appeared = await this.waitForServerTools(name, 60_000);
    if (appeared) {
      const count = this.countLiveTools(name);
      const toolNote = count > 0 ? ` (${count} tool${count !== 1 ? 's' : ''} registered)` : '';
      vscode.window.showInformationMessage(
        `MCP Server Explorer: "${name}" is running${toolNote}.`,
      );
    } else {
      // Config write succeeded — the server may still be starting.
      // Use an information message, not a warning, to avoid false alarms.
      vscode.window.showInformationMessage(
        `MCP Server Explorer: "${name}" was ${action}. ` +
        `If it doesn't appear in the tree, check the Output panel.`,
      );
    }
  }

  // ── LM tools helpers ────────────────────────────────────────

  /**
   * Waits for a server's tools to appear in vscode.lm.tools.
   *
   * Uses BOTH polling (every 2 s) and the onDidChangeTools event to avoid
   * the race condition where tools appear between the initial check and the
   * event subscription. Timeout of 60 s accommodates slow npx-based servers.
   */
  private waitForServerTools(serverName: string, timeoutMs: number): Promise<boolean> {
    // Immediate check
    if (this.serverHasTools(serverName)) { return Promise.resolve(true); }

    return new Promise<boolean>((resolve) => {
      let resolved = false;
      const cleanups: vscode.Disposable[] = [];

      const done = (result: boolean) => {
        if (resolved) { return; }
        resolved = true;
        clearTimeout(timer);
        clearInterval(poller);
        this.pendingTimers = this.pendingTimers.filter(t => t !== timer);
        this.pendingIntervals = this.pendingIntervals.filter(i => i !== poller);
        cleanups.forEach(d => d.dispose());
        resolve(result);
      };

      // Timeout
      const timer = setTimeout(() => done(false), timeoutMs);
      this.pendingTimers.push(timer);

      // Poll every 2 s as a reliable fallback (no race conditions)
      const poller = setInterval(() => {
        if (this.serverHasTools(serverName)) { done(true); }
      }, 2000);
      this.pendingIntervals.push(poller);

      // Also listen for the event for faster detection
      const lm = this.getLm();
      if (lm?.onDidChangeTools) {
        const sub = lm.onDidChangeTools(() => {
          if (this.serverHasTools(serverName)) { done(true); }
        });
        cleanups.push(sub);
      }
    });
  }

  private serverHasTools(serverName: string): boolean {
    const tools = (this.getLm()?.tools ?? []) as LmTool[];
    return tools.some(t => this.toolMatchesServer(t.name, serverName));
  }

  private countLiveTools(serverName: string): number {
    const tools = (this.getLm()?.tools ?? []) as LmTool[];
    return tools.filter(t => this.toolMatchesServer(t.name, serverName)).length;
  }

  private toolMatchesServer(toolName: string, serverName: string): boolean {
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const sn = normalize(serverName);
    const tn = normalize(toolName);
    return tn === sn
      || tn.startsWith(sn + '_')
      || tn.startsWith('mcp_' + sn + '_')
      || tn.startsWith('mcp__' + sn + '__');
  }

  private isLmAvailable(): boolean {
    return Array.isArray(this.getLm()?.tools);
  }

  private getLm(): LmNamespace | undefined {
    return (vscode as unknown as Record<string, unknown>).lm as LmNamespace | undefined;
  }

  dispose(): void {
    this.pendingTimers.forEach(t => clearTimeout(t));
    this.pendingIntervals.forEach(i => clearInterval(i));
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
