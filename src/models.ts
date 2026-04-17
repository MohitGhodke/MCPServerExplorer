// ── MCP Server Explorer — Data Models ─────────────────────────

export type McpServerType = 'stdio' | 'http' | 'sse';
export type McpScope = 'user' | 'workspace';

/** Raw server configuration as stored in mcp.json */
export interface McpServerConfig {
  type?: McpServerType;
  /** stdio fields */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  envFile?: string;
  /** http/sse fields */
  url?: string;
  headers?: Record<string, string>;
  /** sandbox */
  sandboxEnabled?: boolean;
  sandbox?: {
    filesystem?: {
      allowWrite?: string[];
      denyRead?: string[];
      denyWrite?: string[];
    };
    network?: {
      allowedDomains?: string[];
      deniedDomains?: string[];
    };
  };
  /** dev mode */
  dev?: {
    watch?: string;
    debug?: boolean;
  };
}

/** Parsed mcp.json structure */
export interface McpConfigFile {
  servers?: Record<string, McpServerConfig>;
  inputs?: McpInputVariable[];
  /**
   * Servers that have been disabled by MCP Server Explorer.
   * VS Code only reads "servers", so entries here are kept in the file but
   * won't be started. Our extension shows them with a disabled indicator.
   */
  disabledServers?: Record<string, McpServerConfig>;
}

export interface McpInputVariable {
  type: string;
  id: string;
  description: string;
  password?: boolean;
}

/** A tree node representing a scope group (User Profile / Workspace) */
export interface McpScopeNode {
  kind: 'scope';
  scope: McpScope;
  label: string;
  filePath: string | undefined;
  serverCount: number;
}

/** A tree node representing a single MCP server */
export interface McpServerNode {
  kind: 'server';
  name: string;
  scope: McpScope;
  serverType: McpServerType;
  config: McpServerConfig;
  filePath: string | undefined;
  /** true when the server was manually stopped via the lifecycle manager */
  stopped?: boolean;
}

/** A detail row beneath a server node */
export interface McpServerDetailNode {
  kind: 'detail';
  label: string;
  value: string;
  parentServer: McpServerNode;
}

export type McpTreeNode = McpScopeNode | McpServerNode | McpServerDetailNode;

// ── Usage tracking ──────────────────────────────────────────

/** Persisted activity record for one MCP server, tracked across sessions. */
export interface ServerUsageRecord {
  serverName: string;
  /** Times this server's tools became available in VS Code (server started/restarted). */
  activationCount: number;
  /** Unix-ms timestamp of the last detected activation. */
  lastActiveAt: number | undefined;
  /** Highest number of tools observed for this server in a single snapshot. */
  maxToolCount: number;
}
