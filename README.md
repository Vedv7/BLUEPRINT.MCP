# BLUEPRINT.MCP

**Repository:** [github.com/Vedv7/BLUEPRINT.MCP](https://github.com/Vedv7/BLUEPRINT.MCP)

Blueprint gives AI coding agents architectural memory.

It helps Cursor and Claude Code reuse existing abstractions, avoid duplicate helpers, and follow repository structure with advisory-first guidance.

## Use in your repo

```bash
npm install blueprint-arch-mcp
```

See **[docs/USE-IN-YOUR-REPO.md](docs/USE-IN-YOUR-REPO.md)** for install, MCP setup, monorepo config, and **PR comment bot** workflow.

## Quickstart

From `blueprint-mcp/`:

```bash
npm install
npm run build
node dist/cli/index.js init
node dist/cli/index.js scan
node dist/cli/index.js mcp
```

## Validate (one command)

Run the common local/CI workflow without chaining seven commands:

```bash
npx blueprint validate
```

Runs, in order: `scan` → `doctor` → `check --ci` → `adr check --ci` → `snapshot` (single index pass).

For architecture visibility (report, graph, domains, domain-health):

```bash
npx blueprint validate --full
```

Strict CI gates (fail on warnings):

```bash
npx blueprint validate --strict
```

## Cursor integration rule

Copy the agent rule into your editor (e.g. Cursor → `.cursor/rules/blueprint.mdc`):

- `docs/agent-rule-blueprint.mdc`

The rule ensures the agent calls:

- `find_existing_abstractions`
- `suggest_file_placement`
- `suggest_import_reuse`

before creating new helpers, utilities, services, components, routes, or abstractions.

## Architectural decision memory (ADR)

Blueprint preserves **why** architecture choices were made — not just what files exist.

```bash
npx blueprint adr new -t "Auth pattern" -d "Use JWT sessions." -r "Stateless scaling" \
  -c "Auth logic must remain under src/lib/auth/**" --avoid "Direct DB access from middleware"
npx blueprint adr list
npx blueprint adr show ADR-001
npx blueprint adr check
npx blueprint adr check --format=markdown
npx blueprint adr suggest
npx blueprint decide -t "..." -d "..."   # alias for adr new
```

Decisions live in `.blueprint/decisions/` (status: `proposed` | `accepted` | `superseded` | `deprecated`). Only **accepted** ADRs enforce checks. Included in PR comments, `blueprint.memory.json`, and MCP `explain_architectural_decisions`.

## Domain intelligence

Blueprint infers **business domains** (payments, auth, analytics, …) from paths, builds **ownership stacks** (controller → service → repository), detects **cross-domain violations** and **architectural drift**, and scores repository health.

```bash
node dist/cli/index.js domains
node dist/cli/index.js domain-health
node dist/cli/index.js domain-check
```

MCP tools: `infer_domains`, `domain_health`, `explain_domain_boundaries`. Domain-aware guidance is included in `find_existing_abstractions` and `verify_and_place_code`.

## Demo (magic loop)

Run a deterministic demo that includes an existing `formatCurrency()` utility and verifies a proposed duplicate utility:

```bash
npm run demo:magic
```

Expected behavior: advisory guidance suggests reusing an existing abstraction and following placement recommendations.

## Project Report

Blueprint can summarize repository architectural memory even before an agent acts:

```bash
npx blueprint report
```

Example output:

```text
Blueprint Report

Framework: Next.js
Files scanned: 42
Symbols indexed: 118
Path aliases: @/*
Placement rules: 4 active

Top reusable abstractions:
- formatCurrency → src/lib/currency.ts
- validateEmail → src/lib/validation.ts
- fetchWithRetry → src/lib/http.ts

Duplicate-risk clusters:
- currency formatting: formatCurrency, formatMoney
- email validation: validateEmail, checkEmailAddress

Recommended actions:
- Reuse src/lib/currency.ts for money formatting
- Keep auth helpers under src/lib/auth
```

This makes Blueprint a repo architecture visibility tool, not only a reactive MCP guardrail.

## Policy Check

Run architecture policy validation:

```bash
npx blueprint check
```

`blueprint check` reports:
- forbidden import boundary violations
- required placement violations
- duplicate-like utility warnings

It exits with a non-zero code when violations are found.

### CI mode

Use `--ci` in GitHub Actions for clean logs (no JSON trailer):

```bash
npx blueprint check --ci
```

### GitHub Action

```yaml
- name: Blueprint Architecture Check
  run: npx blueprint check --ci
```

A reference workflow lives at `.github/workflows/blueprint-check.yml`.

### Infer rules

Analyze repository structure and import patterns to suggest policies:

```bash
npx blueprint infer-rules
```

Example suggestions:
- `src/components/**` should not import `src/server/**`
- `src/lib/payments/internal/**` should stay inside payments
- hooks should live under `src/hooks`
- auth helpers should live under `src/lib/auth`

Copy suggested `policies` into `blueprint.config.json`, then run `npx blueprint check --ci`.

### PR report output

Markdown output for PR comments:

```bash
npx blueprint check --format=markdown
```

## Architecture Graph

Build module-level architecture visibility and boundary risk detection:

```bash
npx blueprint graph
```

Example sections:
- `Modules`
- `Dependency flows`
- `Boundary risks`
- `Suggested policies`

This command stores resolved file imports in SQLite, resolves relative and alias imports, and highlights risky boundaries (like components importing server-only modules).

## Semantic Architecture Intelligence

Blueprint can detect renamed and semantically equivalent helpers using local MiniLM embeddings.

Enable in `blueprint.config.json`:

```json
"embeddings": {
  "enabled": true,
  "model": "Xenova/all-MiniLM-L6-v2",
  "hybridWeights": { "heuristic": 0.55, "semantic": 0.45 }
}
```

Then scan:

```bash
npx blueprint scan
npx blueprint report
```

`report` includes **Semantic duplicate clusters** (for example currency formatting helpers with different names).

Duplicate detection uses **hybrid scoring** (heuristics + path context + semantic similarity). Embeddings are cached per file hash and only regenerated when files change.

Example advisory reasons:

```text
Confidence: HIGH
Reasons:
- similar function intent
- matching parameter structure
- semantic similarity: 0.91
```

## MCP tools (V1)

- `scan_repo`: index exported TS/JS symbols into a local SQLite db.
- `find_existing_abstractions`: advisory-first ranked reuse suggestions for proposed symbols.
- `suggest_file_placement`: advisory placement guidance based on intent + rules.
- `suggest_import_reuse`: canonical import reuse suggestion.
- `explain_architecture_boundaries`: module graph, dependency flows, and boundary risks.

Compatibility aliases remain available for migration:
- `find_duplicates` -> `find_existing_abstractions`
- `suggest_import` -> `suggest_import_reuse`
- `verify_and_place_code` (combined check, advisory-first by default)

## Advisory-first mode

Blueprint defaults to `"enforcementMode": "advisory"` in `blueprint.config.json`.
In advisory mode, high-confidence issues return guidance instead of hard blocking.
Set `"enforcementMode": "enforce"` only when teams are ready for strict blocking on high-severity issues.


<!-- Blueprint PR bot validation -->
<!-- upsert re-run -->
