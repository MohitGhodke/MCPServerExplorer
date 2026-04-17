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
- **Language Model Tool** — Exposes `mcpServerExplorer_getServerStatus` so other Copilot agents can query your MCP server status

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

| Command | Description |
|---------|-------------|
| `MCP Server Explorer: Add MCP Server` | Guided flow to add a new server |
| `MCP Server Explorer: Refresh` | Reload configs from disk |
| `MCP Server Explorer: Import Server Configs` | Import servers from a JSON file |
| `MCP Server Explorer: Export All Server Configs` | Export all servers to a JSON file |
| `MCP Server Explorer: Open User MCP Config` | Open user-level `mcp.json` |
| `MCP Server Explorer: Open Workspace MCP Config` | Open workspace-level `mcp.json` |

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
