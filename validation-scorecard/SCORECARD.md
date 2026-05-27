# Blueprint Phase 5 — Real Repo Validation Scorecard

**Blueprint commit:** `ea3841e`  
**CI:** [GitHub Actions](https://github.com/Vedv7/BLUEPRINT.MCP/actions) — latest `main` push **passed**  
**Generated:** 2026-05-27

## CI status

| Check | Result |
|-------|--------|
| `Blueprint Architecture Check` (push `ea3841e`) | **Success** (~26s) |
| Typecheck + build + test + demo:magic | **34/34 tests** |

---

## Repo scorecard

| Metric | next-blueprint-demo | Review-Gate | RankStream |
|--------|---------------------|-------------|------------|
| **All commands exit 0** | Yes | Yes | Yes |
| **Files indexed (scan)** | 5 | 8 | 80 |
| **Symbols indexed** | 5 | 33 | 295 |
| **Import edges** | 5 | 77 | 545 |
| **TypeScript parsed** | 5 | 0 | 2 |
| **JavaScript parsed** | 0 | 4 | 0 |
| **Python parsed** | 0 | 4 | 10 |
| **Java parsed** | 0 | 0 | 68 |
| **Check violations** | 0 | 0 | 0 |
| **Check warnings** | 0 | 0 | 0 |
| **Snapshot** | Yes | Yes | Yes |

---

## Per-repo notes

### 1. next-blueprint-demo (Next.js)

| | |
|--|--|
| **Signal** | High — small TS app, full coverage |
| **False positives** | None observed |
| **False negatives** | N/A (repo is tiny) |
| **Useful advisories** | `verify formatMoney` duplicate detection works (demo:magic) |
| **Tuning** | Default config sufficient |

### 2. Review-Gate (Python + CommonJS extension)

| | |
|--|--|
| **Signal** | High — **4 JS + 4 Python** files, **33 symbols**, **77 imports** (was ~0 before Phase 1–2) |
| **False positives** | None on check; graph clean |
| **False negatives** | Planning/docs folders correctly skipped |
| **Useful advisories** | Doctor shows Python supported + JS supported |
| **Tuning** | Uses custom `blueprint.config.json` with `V2/**` JS includes |

### 3. RankStream (Java + Python + TS frontend)

| | |
|--|--|
| **Signal** | High — **68 Java**, **10 Python**, **2 TS** files; **295 symbols** |
| **False positives** | Prior risk: “allowed Spring flow” listed as boundary risk — **fixed in Phase 5** |
| **False negatives** | Narrow `config.include` only targets frontend; backend indexed via adapter defaults (doctor now explains this) |
| **Useful advisories** | Cross-language graph: `frontend → backend`, `backend → ml-service`; Spring layering when configured |
| **Tuning** | Recommend `languages.java.include` + `languages.python.include` in `blueprint.config.json` for explicit scope |

---

## Phase 5 hardening applied

| Area | Change |
|------|--------|
| **Graph noise** | Allowed Spring flows moved to dependency flows only; risks are violations/discouraged only |
| **Strictness** | `strictness: "lenient" \| "balanced" \| "strict"` in config (default `balanced`) |
| **Doctor** | Human-readable by default; `--json` for machine output; shows `Files indexed` vs configured globs |
| **Duplicates** | Higher similarity threshold (0.55); disabled in `lenient` |
| **Spring warnings** | Controller→repository warning only in `balanced`/`strict` |
| **PR bot** | `.github/workflows/blueprint-pr-comment.yml` posts check + graph + doctor on PRs |

---

## Recommended `blueprint.config.json` for RankStream

```json
{
  "strictness": "balanced",
  "languages": {
    "typescript": { "enabled": true, "include": ["frontend/**"] },
    "python": { "enabled": true, "include": ["ml-service/**"] },
    "java": { "enabled": true, "include": ["backend/**", "src/main/java/**"] }
  }
}
```

---

## Verdict

| Repo | Production usefulness |
|------|----------------------|
| next-blueprint-demo | Ready |
| Review-Gate | Ready (JS/Python) |
| RankStream | Ready (Java/Python/TS) with config tuning |

**Do not add Go/Rust/C# until** PR comment bot is validated on a real PR and RankStream config is checked in.
