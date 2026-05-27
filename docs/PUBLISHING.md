# Publishing @vedv7/blueprint-mcp to npm

The unscoped name `blueprint-mcp` is taken on npm (another project). This package publishes as **`@vedv7/blueprint-mcp`**.

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
npm install @vedv7/blueprint-mcp
npx blueprint doctor
```

Point MCP config at `node_modules/@vedv7/blueprint-mcp/dist/cli/index.js mcp`.

## Repository

https://github.com/Vedv7/BLUEPRINT.MCP
