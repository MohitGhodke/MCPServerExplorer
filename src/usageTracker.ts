import * as vscode from 'vscode';
import { ServerUsageRecord } from './models';

/**
 * Tracks MCP server activity using VS Code's Language Model Tools API.
 *
 * VS Code exposes every registered LM tool (including those from MCP servers)
 * via `vscode.lm.tools`. When an MCP server starts, its tools appear there;
 * when it stops they disappear.
 *
 * Tool-to-server mapping uses a prefix convention: a server named "github"
 * registers tools like "github_search_repos". We also try the double-underscore
 * variant used in some VS Code builds ("mcp__github__search_repos") and a
 * direct tag match if VS Code surfaces tags for MCP tools in the future.
 *
 * All counts are persisted in `context.globalState` and survive restarts.
 *
 * NOTE: `vscode.lm.onDidChangeTools` was removed in VS Code 1.99+. Tool counts
 * are now refreshed on-demand (each call to getLiveToolCount reads the current
 * snapshot) and via a polling interval started here.
 */
export class UsageTracker implements vscode.Disposable {

  private static readonly STORAGE_KEY = 'mcpServerExplorer.usage.v1';

  private data = new Map<string, ServerUsageRecord>();
  private prevToolNames = new Set<string>();
  private disposables: vscode.Disposable[] = [];

  private _onChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onChange.event;

  constructor(private context: vscode.ExtensionContext) {
    this.load();
    this.attachLmObserver();
  }

  // ── Public API ──────────────────────────────────────────────

  /**
   * Call after every config reload with the current list of configured server names.
   * Creates new records for newly-seen servers without touching existing counts.
   */
  ensureServers(names: string[]): void {
    let dirty = false;
    for (const name of names) {
      if (!this.data.has(name)) {
        this.data.set(name, {
          serverName: name,
          activationCount: 0,
          lastActiveAt: undefined,
          maxToolCount: 0,
        });
        dirty = true;
      }
    }
    if (dirty) {
      this.save();
      this._onChange.fire();
    }
  }

  getRecord(name: string): ServerUsageRecord | undefined {
    return this.data.get(name);
  }

  /** Returns records only for the given server names (currently configured). */
  getRecordsFor(names: string[]): ServerUsageRecord[] {
    return names.map(n => this.data.get(n) ?? {
      serverName: n, activationCount: 0, lastActiveAt: undefined, maxToolCount: 0,
    });
  }

  /** Live count of tools currently registered in VS Code for this server. */
  getLiveToolCount(serverName: string): number {
    if (!this.isLmApiAvailable()) { return 0; }
    return vscode.lm.tools.filter(t => this.matchesServer(serverName, t)).length;
  }

  /** Live total of all LM tools currently registered in VS Code. */
  getTotalLiveTools(): number {
    if (!this.isLmApiAvailable()) { return 0; }
    return vscode.lm.tools.length;
  }

  /** Names of configured servers that currently have tools visible in VS Code. */
  getActiveServerNames(configuredNames: string[]): string[] {
    if (!this.isLmApiAvailable()) { return []; }
    const tools = vscode.lm.tools;
    if (tools.length === 0) { return []; }
    return configuredNames.filter(n => tools.some(t => this.matchesServer(n, t)));
  }

  /** Whether `vscode.lm.tools` is available in this VS Code version. */
  isLmApiAvailable(): boolean {
    return Array.isArray(vscode.lm?.tools);
  }

  resetAll(): void {
    for (const [k, v] of this.data.entries()) {
      this.data.set(k, { ...v, activationCount: 0, lastActiveAt: undefined, maxToolCount: 0 });
    }
    this.save();
    this._onChange.fire();
  }

  // ── LM tools observation ────────────────────────────────────

  private attachLmObserver(): void {
    if (!this.isLmApiAvailable()) { return; }

    this.snapshotTools();

    // vscode.lm.onDidChangeTools was removed in VS Code 1.99+.
    // Poll every 5 s as a lightweight fallback to detect tool changes.
    const interval = setInterval(() => {
      this.snapshotTools();
    }, 5000);
    // Store a disposable that clears the interval on dispose.
    this.disposables.push({ dispose: () => clearInterval(interval) });
  }

  private snapshotTools(): void {
    const tools = Array.isArray(vscode.lm.tools) ? vscode.lm.tools : [];
    const currentNames = new Set(tools.map(t => t.name));

    for (const [serverName, record] of this.data.entries()) {
      const currentCount = tools.filter(t => this.matchesServer(serverName, t)).length;
      const prevCount = [...this.prevToolNames].filter(
        n => this.matchesServer(serverName, { name: n }),
      ).length;

      if (currentCount > 0 && prevCount === 0) {
        // Server just became active — count as an activation
        record.activationCount++;
        record.lastActiveAt = Date.now();
        record.maxToolCount = Math.max(record.maxToolCount, currentCount);
        this.data.set(serverName, { ...record });
      } else if (currentCount > 0) {
        record.maxToolCount = Math.max(record.maxToolCount, currentCount);
        this.data.set(serverName, { ...record });
      }
    }

    this.prevToolNames = currentNames;
    this.save();
    this._onChange.fire();
  }

  private matchesServer(serverName: string, tool: { name: string; tags?: readonly string[] | undefined }): boolean {
    // 1. Tag match — most reliable if VS Code surfaces tags for MCP tools
    if (tool.tags?.some(tag => tag.toLowerCase() === serverName.toLowerCase())) {
      return true;
    }

    // 2. Prefix match — normalise both sides so hyphens/special chars don't cause mismatches
    //    e.g. server "angular-cli" → "angular_cli", tool "mcp_angular-cli_ai_tutor" → "mcp_angular_cli_ai_tutor"
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const sn = normalize(serverName);
    const tn = normalize(tool.name);
    return tn === sn
      || tn.startsWith(sn + '_')
      || tn.startsWith('mcp_' + sn + '_')
      || tn.startsWith('mcp__' + sn + '__');
  }

  // ── Persistence ──────────────────────────────────────────────

  private load(): void {
    const stored = this.context.globalState.get<Record<string, ServerUsageRecord>>(
      UsageTracker.STORAGE_KEY, {},
    );
    for (const [k, v] of Object.entries(stored)) {
      this.data.set(k, v);
    }
  }

  private save(): void {
    const obj: Record<string, ServerUsageRecord> = {};
    for (const [k, v] of this.data.entries()) { obj[k] = v; }
    this.context.globalState.update(UsageTracker.STORAGE_KEY, obj);
  }

  dispose(): void {
    this._onChange.dispose();
    this.disposables.forEach(d => d.dispose());
  }
}
