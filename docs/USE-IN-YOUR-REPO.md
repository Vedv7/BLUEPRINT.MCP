# Use Blueprint in Your Repository

Blueprint scans your codebase, indexes architectural memory, and can comment on pull requests.

## Install

```bash
npm install blueprint-arch-mcp
# or from GitHub until published:
# npm install github:Vedv7/BLUEPRINT.MCP
```

Requires **Node.js 20+** and **Python 3** on PATH (for Python adapter).

## Quick setup

```bash
npx blueprint init
npx blueprint scan
npx blueprint doctor
```

## Cursor / MCP

Add to `.cursor/mcp.json` (or your MCP config):

```json
{
  "mcpServers": {
    "blueprint": {
      "command": "node",
      "args": ["node_modules/blueprint-arch-mcp/dist/cli/index.js", "mcp"],
      "cwd": "."
    }
  }
}
```

Copy `docs/agent-rule-blueprint.mdc` → `.cursor/rules/blueprint.mdc`.

## CLI commands

| Command | Purpose |
|---------|---------|
| `npx blueprint scan` | Index symbols and imports |
| `npx blueprint doctor` | Language coverage and health |
| `npx blueprint report` | Architecture memory report |
| `npx blueprint graph` | Module flows and boundary risks |
| `npx blueprint check` | Policy violations |
| `npx blueprint check --format=markdown` | PR-friendly check output |
| `npx blueprint snapshot` | Write `blueprint.memory.json` |

## Multi-language monorepos

```json
{
  "strictness": "balanced",
  "languages": {
    "typescript": { "enabled": true, "include": ["frontend/**", "src/**"] },
    "python": { "enabled": true, "include": ["ml-service/**"] },
    "java": { "enabled": true, "include": ["backend/**", "src/main/java/**"] }
  }
}
```

## PR comments (GitHub Actions)

Copy this workflow to your repo:

**`.github/workflows/blueprint-pr-comment.yml`**

See [BLUEPRINT.MCP](https://github.com/Vedv7/BLUEPRINT.MCP/blob/main/.github/workflows/blueprint-pr-comment.yml).

The bot:

1. Runs `scan`, `doctor`, `check --format=markdown`, and `graph`
2. Posts one PR comment with a hidden marker `<!-- blueprint-pr-comment -->`
3. **Updates** that same comment on new pushes (no spam)

### CI check (fail on violations)

```yaml
- run: npx blueprint check --ci
```

Copy from [blueprint-check.yml](https://github.com/Vedv7/BLUEPRINT.MCP/blob/main/.github/workflows/blueprint-check.yml).

## Strictness

```json
{
  "strictness": "lenient"
}
```

- `lenient` — fewer warnings, good for adoption
- `balanced` — default
- `strict` — more Spring / duplicate warnings
