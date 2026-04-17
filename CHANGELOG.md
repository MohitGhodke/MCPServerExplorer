# Changelog

## [0.1.0] - 2026-04-17

### Added

- Unified sidebar view showing all MCP servers from User Profile and Workspace configs
- Guided multi-step flow to add stdio, HTTP, or SSE servers
- Remove, edit, and copy server configurations
- Import/Export server configurations via JSON files
- Dashboard with server counts by type and scope
- Live reload when `mcp.json` files change on disk
- Start, stop, and restart MCP servers
- Activity statistics tracking

### Copilot Integration

- `@mcp-explorer` chat participant with `/list`, `/add`, `/diagnose`, `/suggest`, `/share` commands
- "Describe with Copilot" option when adding servers via the UI
- `mcpServerExplorer_getServerStatus` language model tool for other agents
- LLM-powered server diagnostics and workspace-aware server recommendations
