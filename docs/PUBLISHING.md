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

## Publish (manual first)

```bash
npm login
npm run test:all
npm publish --access public
```

## Automated publish (after manual publish works once)

Push a version tag — workflow `.github/workflows/npm-publish.yml` runs tests, build, and `npm publish`.

Requires repository secret: `NPM_TOKEN`.

```bash
git tag v0.2.0
git push origin v0.2.0
```

## CI governance gates

```bash
npx blueprint check --ci          # fail on violations only
npx blueprint check --ci --strict # fail on violations + warnings
npx blueprint adr check --ci --strict
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
