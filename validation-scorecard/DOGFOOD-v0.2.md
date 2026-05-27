# Blueprint v0.2.0 dogfood (local)

Date: 2026-05-27

## Commands run per repo

`scan` · `report` · `graph` · `domains` · `check --ci` · `adr check --format=markdown` · `snapshot`

| Repo | scan | graph | domains | check --ci | adr check | snapshot |
|------|------|-------|---------|------------|-----------|----------|
| blueprint-mcp | OK | OK | OK | OK | 0 violations | health 100, 1 domain |
| examples/demo-repo | OK | OK | OK | OK | **1 violation** (ADR-001 vs formatMoney) | health 100, 1 ADR |
| next-blueprint-demo | OK | OK | OK | OK | 0 violations | health 100, 2 domains |

## CI strict gates (new)

```bash
blueprint check --ci          # fail on violations only
blueprint check --ci --strict # fail on violations + warnings
blueprint adr check --ci --strict
```

- **Advisory mode** (`enforcementMode: advisory`): warnings do not fail CI unless `--strict`.
- **Accepted ADRs** enforce; proposed/superseded do not.

## PR comment

Workflow includes: Doctor · Policy check · **ADR check** · Architecture graph.

## Next

1. Manual `npm publish` for `blueprint-arch-mcp@0.2.0`
2. Push tag `v0.2.0` with `NPM_TOKEN` secret for automated publish
