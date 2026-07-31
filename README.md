# MCP Server Explorer · Copilot Ready

Browse, manage, and import/export MCP (Model Context Protocol) server configurations from a unified sidebar — no JSON editing required. Fully integrated with GitHub Copilot.

## Features

- **Unified Sidebar View** — See all MCP servers from both User Profile and Workspace configs in one tree view
- **Add Servers via UI** — Guided multi-step flow to add stdio, HTTP, or SSE servers without editing JSON
- **Remove Servers** — Right-click to remove a server from its config file
- **Edit in Config** — Jump directly to the server's position in `mcp.json`
- **Import / Export** — Share server configurations between machines or team members via JSON files
- **Copy to Clipboard** — Quickly copy a single server's config for sharing
- **Dashboard** — At-a-glance summary of server counts by type and scope
- **Live Reload** — Tree auto-refreshes when `mcp.json` files change on disk

### Copilot Integration

- **`@mcp-explorer` Chat Participant** — Manage servers directly from Copilot Chat
- **`/list`** — Show all configured servers with status and tool counts
- **`/add <description>`** — Add a server using natural language (e.g., "add Playwright for browser testing")
- **`/diagnose <name>`** — Run a full diagnostic on a server — config validation, tool registration, LLM-powered analysis
- **`/suggest`** — Get personalized MCP server recommendations based on your workspace
- **`/share [name]`** — Generate formatted server config for sharing in README or Slack
- **Describe with Copilot** — When adding servers via the **+** button, choose "Describe with Copilot" to generate config from plain English
- **`#mcpServerStatus` Language Model Tool** — Lets Copilot's agent (and any other agent) query the status and tool counts of your configured MCP servers. Reference it directly in chat with `#mcpServerStatus`, or just ask a question like *"are my MCP servers running?"* and the agent will call it automatically.

## Where are MCP configs stored?

| Scope | Location | Shared? |
|-------|----------|---------|
| **User Profile** | `~/Library/Application Support/Code/User/mcp.json` (macOS) | Per-machine |
| **Workspace** | `.vscode/mcp.json` in your project | Yes, via source control |

## Getting Started

1. Install the extension
2. Click the MCP Server Explorer icon in the activity bar (sidebar)
3. Your existing MCP servers will appear automatically
4. Use the **+** button to add new servers, or **Import** to bring in configs from a file

## Commands

Available from the command palette (all prefixed **MCP Server Explorer:**):

| Command | Description |
|---------|-------------|
| `Add MCP Server` | Guided flow to add a new server |
| `Refresh` | Reload configs from disk |
| `Import Server Configs` | Import servers from a JSON file |
| `Export All Server Configs` | Export all servers to a JSON file |
| `Open User MCP Config` | Open user-level `mcp.json` |
| `Open Workspace MCP Config` | Open workspace-level `mcp.json` |
| `Refresh Dashboard` | Recompute the server counts shown in the Dashboard |
| `Reset Activity Statistics` | Clear recorded server activity stats |

These act on a specific server and are available from the right-click menu on any server in the tree:

| Command | Description |
|---------|-------------|
| `Start Server` / `Stop Server` / `Restart Server` | Control the server's lifecycle and wait for its tools to register |
| `Remove Server` | Delete the server from its config file |
| `Edit Server in Config` | Jump to the server's entry in `mcp.json` |
| `Export Server Config` | Write a single server's config to a JSON file |
| `Copy Server Config to Clipboard` | Copy a single server's config for sharing |

## Import/Export Format

Exported files use this structure:

```json
{
  "mcpServerExplorer": "1.0",
  "servers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp"
    },
    "playwright": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@microsoft/mcp-server-playwright"]
    }
  }
}
```

## Requirements

- VS Code 1.95.0 or later
- GitHub Copilot extension (for chat participant and LM features)

## License

MIT
