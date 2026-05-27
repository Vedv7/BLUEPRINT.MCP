# Publishing blueprint-arch-mcp to npm

The name `blueprint-mcp` is taken on npm (another project). This package publishes as **`blueprint-arch-mcp`**.

## Pre-publish checklist

- [ ] `npm run test:all` passes
- [ ] `npm run build` produces `dist/`
- [ ] `files` in package.json includes: `dist`, `bin`, `python`, `docs`
- [ ] Version bumped in `package.json`
- [ ] `CHANGELOG` updated (optional)
- [ ] Git tag `v0.x.x` created

## Dry run

```bash
npm pack --dry-run
```

Verify `python/parse_ast.py` and `bin/blueprint.mjs` are included.

## Publish

```bash
npm login
npm publish
```

## After publish

Consumers install with:

```bash
npm install blueprint-arch-mcp
npx blueprint doctor
```

Point MCP config at `node_modules/blueprint-arch-mcp/dist/cli/index.js mcp`.

## Repository

https://github.com/Vedv7/BLUEPRINT.MCP
