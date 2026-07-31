# Changelog

All notable changes to **MCP Server Explorer · Copilot Ready** are documented here.

---

## [0.1.2] — 2026-05-01

### Fixed

- **Tool detection on VS Code 1.99+** — `vscode.lm.onDidChangeTools` was removed from the API, so the event listener used to detect a server's tools appearing after a start or restart never fired. Detection now relies solely on polling `vscode.lm.tools` every 2 s for up to 60 s, which works across versions.
- **Silent config read failures** — errors while reading an `mcp.json` were swallowed by a bare `catch {}`. Read failures are now logged to the output channel with the underlying message, so a malformed or unreadable config is diagnosable instead of showing an empty tree.

### Changed

- Removed the hand-rolled `LmNamespace` / `LmTool` shims and the `getLm()` feature-detection helper in favour of reading `vscode.lm` directly with an `Array.isArray` guard.

## [0.1.1] — 2026-04-17

- Initial published release.

## [0.1.0] — 2026-04-17

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
