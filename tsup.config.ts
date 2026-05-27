import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "cli/index": "src/cli/index.ts",
    "mcp/server": "src/mcp/server.ts"
  },
  format: ["esm"],
  sourcemap: true,
  dts: false,
  clean: true,
  target: "es2022",
  platform: "node",
  splitting: false
});

