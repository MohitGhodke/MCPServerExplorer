import * as vscode from 'vscode';
import { ServerUsageRecord } from './models';
import { ServerTreeProvider } from './serverTreeProvider';
import { UsageTracker } from './usageTracker';

// ── Tree node types ──────────────────────────────────────────

export type SummaryItem =
  | { kind: 'section'; id: string; label: string }
  | { kind: 'stat'; id: string; label: string; value: string; icon: string }
  | { kind: 'serverRow'; serverName: string; rank: number; stopped?: boolean }
  | { kind: 'empty'; id: string; label: string };

// ── Provider ─────────────────────────────────────────────────

export class SummaryTreeProvider implements vscode.TreeDataProvider<SummaryItem>, vscode.Disposable {

  private _onDidChangeTreeData = new vscode.EventEmitter<SummaryItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private disposables: vscode.Disposable[] = [];

  constructor(
    private serverTreeProvider: ServerTreeProvider,
    private usageTracker: UsageTracker,
  ) {
    this.disposables.push(
      serverTreeProvider.onDidChangeTreeData(() => this._onDidChangeTreeData.fire()),
      usageTracker.onDidChange(() => this._onDidChangeTreeData.fire()),
    );
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  // ── TreeDataProvider ────────────────────────────────────────

  getTreeItem(element: SummaryItem): vscode.TreeItem {
    switch (element.kind) {
      case 'section':   return this.buildSectionItem(element);
      case 'stat':      return this.buildStatItem(element);
      case 'serverRow': return this.buildServerRowItem(element);
      case 'empty':     return this.buildEmptyItem(element);
    }
  }

  getChildren(element?: SummaryItem): SummaryItem[] {
    if (!element) {
      return this.buildRoots();
    }
    if (element.kind === 'section') {
      return this.buildSectionChildren(element.id);
    }
    return [];
  }

  // ── Root nodes ───────────────────────────────────────────────

  private buildRoots(): SummaryItem[] {
    const allServers = this.serverTreeProvider.getAllServers();
    if (allServers.length === 0) {
      return [];
    }
    return [
      { kind: 'section', id: 'overview',  label: 'Overview' },
      { kind: 'section', id: 'activity',  label: 'Server Activity' },
    ];
  }

  // ── Section children ─────────────────────────────────────────

  private buildSectionChildren(sectionId: string): SummaryItem[] {
    switch (sectionId) {

      case 'overview': {
        const allServers = this.serverTreeProvider.getAllServers();
        const configuredNames = allServers.map(s => s.name);
        const stoppedCount = allServers.filter(s => s.stopped).length;
        const activeNames = this.usageTracker.getActiveServerNames(configuredNames);
        const lmAvailable = this.usageTracker.isLmApiAvailable();

        const activeValue = lmAvailable
          ? `${activeNames.length} / ${allServers.length}`
          : '— (VS Code 1.100+ required)';

        const toolsValue = lmAvailable
          ? String(this.usageTracker.getTotalLiveTools())
          : '—';

        const rows: SummaryItem[] = [
          { kind: 'stat', id: 'stat_total',  label: 'Configured Servers', value: String(allServers.length),                                    icon: 'server' },
          { kind: 'stat', id: 'stat_active', label: 'Currently Active',   value: activeValue,                                                  icon: 'pass-filled' },
          { kind: 'stat', id: 'stat_tools',  label: 'Tools Registered',   value: toolsValue,                                                   icon: 'tools' },
          { kind: 'stat', id: 'stat_user',   label: 'User Profile',        value: String(this.serverTreeProvider.getUserServers().length),      icon: 'account' },
          { kind: 'stat', id: 'stat_ws',     label: 'Workspace',           value: String(this.serverTreeProvider.getWorkspaceServers().length), icon: 'folder-opened' },
        ];
        if (stoppedCount > 0) {
          rows.splice(2, 0, { kind: 'stat', id: 'stat_stopped', label: 'Stopped', value: String(stoppedCount), icon: 'circle-slash' });
        }
        return rows;
      }

      case 'activity': {
        const allServers = this.serverTreeProvider.getAllServers();
        const configuredNames = allServers.map(s => s.name);

        if (configuredNames.length === 0) {
          return [{ kind: 'empty', id: 'empty_activity', label: 'No servers configured' }];
        }

        const stoppedNames = new Set(allServers.filter(s => s.stopped).map(s => s.name));

        // Sort by activation count descending, then alphabetically
        const records = this.usageTracker.getRecordsFor(configuredNames);
        records.sort((a, b) =>
          b.activationCount !== a.activationCount
            ? b.activationCount - a.activationCount
            : a.serverName.localeCompare(b.serverName),
        );

        return records.map((r, i) => ({
          kind: 'serverRow' as const,
          serverName: r.serverName,
          rank: i + 1,
          stopped: stoppedNames.has(r.serverName),
        }));
      }

      default:
        return [];
    }
  }

  // ── TreeItem builders ─────────────────────────────────────────

  private buildSectionItem(item: Extract<SummaryItem, { kind: 'section' }>): vscode.TreeItem {
    const ti = new vscode.TreeItem(item.label, vscode.TreeItemCollapsibleState.Expanded);
    ti.id = `summary_section_${item.id}`;
    ti.iconPath = new vscode.ThemeIcon(item.id === 'overview' ? 'dashboard' : 'graph');
    ti.contextValue = 'summarySection';
    return ti;
  }

  private buildStatItem(item: Extract<SummaryItem, { kind: 'stat' }>): vscode.TreeItem {
    const ti = new vscode.TreeItem(item.label, vscode.TreeItemCollapsibleState.None);
    ti.id = `summary_${item.id}`;
    ti.description = item.value;
    ti.iconPath = new vscode.ThemeIcon(item.icon);
    ti.contextValue = 'summaryStat';
    return ti;
  }

  private buildServerRowItem(item: Extract<SummaryItem, { kind: 'serverRow' }>): vscode.TreeItem {
    const record = this.usageTracker.getRecord(item.serverName) ?? {
      serverName: item.serverName,
      activationCount: 0,
      lastActiveAt: undefined,
      maxToolCount: 0,
    };

    const liveTools  = this.usageTracker.getLiveToolCount(item.serverName);
    const lmAvail    = this.usageTracker.isLmApiAvailable();
    const isActive   = liveTools > 0;

    // Description line
    const parts: string[] = [];
    if (item.stopped) {
      parts.push('stopped');
    }
    parts.push(`${record.activationCount} activation${record.activationCount !== 1 ? 's' : ''}`);

    if (lmAvail && !item.stopped) {
      const toolCount = isActive ? liveTools : record.maxToolCount;
      if (toolCount > 0) {
        parts.push(`${toolCount} tool${toolCount !== 1 ? 's' : ''}${isActive ? ' ●' : ''}`);
      }
    } else if (record.maxToolCount > 0 && !item.stopped) {
      parts.push(`${record.maxToolCount} tool${record.maxToolCount !== 1 ? 's' : ''}`);
    }

    if (record.lastActiveAt) {
      parts.push(formatRelativeTime(record.lastActiveAt));
    }

    const ti = new vscode.TreeItem(item.serverName, vscode.TreeItemCollapsibleState.None);
    ti.id = `summary_server_${item.serverName}`;
    ti.description = parts.join(' · ');
    ti.iconPath = new vscode.ThemeIcon(
      item.stopped ? 'circle-slash' : rankIcon(item.rank, isActive),
    );
    ti.contextValue = 'dashboardServer';
    ti.tooltip = this.buildServerTooltip(record, liveTools, lmAvail, item.stopped);
    return ti;
  }

  private buildEmptyItem(item: Extract<SummaryItem, { kind: 'empty' }>): vscode.TreeItem {
    const ti = new vscode.TreeItem(item.label, vscode.TreeItemCollapsibleState.None);
    ti.id = `summary_empty_${item.id}`;
    ti.iconPath = new vscode.ThemeIcon('circle-outline');
    return ti;
  }

  // ── Tooltip ──────────────────────────────────────────────────

  private buildServerTooltip(
    record: ServerUsageRecord,
    liveTools: number,
    lmAvail: boolean,
    stopped?: boolean,
  ): vscode.MarkdownString {
    const md = new vscode.MarkdownString('', true);
    md.appendMarkdown(`### ${record.serverName}${stopped ? ' *(stopped)*' : ''}\n\n`);

    md.appendMarkdown(`| Metric | Value |\n|---|---|\n`);
    md.appendMarkdown(`| Status | ${stopped ? '🔴 Stopped' : liveTools > 0 ? `🟢 Active (${liveTools} tools)` : '⚫ Inactive'} |\n`);
    md.appendMarkdown(`| Activations | ${record.activationCount} |\n`);

    if (!lmAvail) {
      md.appendMarkdown(`| Live tool data | Requires VS Code 1.100+ |\n`);
    } else if (record.maxToolCount > 0) {
      md.appendMarkdown(`| Max tools seen | ${record.maxToolCount} |\n`);
    }

    if (record.lastActiveAt) {
      const date = new Date(record.lastActiveAt);
      md.appendMarkdown(`| Last active | ${date.toLocaleString()} |\n`);
    } else {
      md.appendMarkdown(`| Last active | Never detected |\n`);
    }

    return md;
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
    this.disposables.forEach(d => d.dispose());
  }
}

// ── Helpers ──────────────────────────────────────────────────

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  { return 'just now'; }
  if (mins < 60) { return `${mins}m ago`; }
  const hours = Math.floor(mins / 60);
  if (hours < 24) { return `${hours}h ago`; }
  return `${Math.floor(hours / 24)}d ago`;
}

function rankIcon(rank: number, isActive: boolean): string {
  if (isActive) { return 'circle-filled'; }
  if (rank === 1) { return 'flame'; }
  if (rank === 2) { return 'arrow-up'; }
  if (rank === 3) { return 'graph-line'; }
  return 'circle-outline';
}
