import { defineConfig } from "tsup";

export default defineConfig({
  entry: { server: "src/server.ts" },
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  external: [
    "@opencode-ai/plugin",
    "@opencode-ai/sdk",
    "@opentui/core",
    "@opentui/solid",
    "@opentui/keymap",
    "solid-js",
    "node:crypto",
    "node:fs",
    "node:path",
    "node:os",
    "node:url",
  ],
});
