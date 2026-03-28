import { defineConfig } from "tsup";
import { existsSync } from "node:fs";

// Build cli.ts only if it exists (created in Phase 7)
const entry = ["src/index.ts", "src/server.ts"];
if (existsSync("src/cli.ts")) entry.push("src/cli.ts");

export default defineConfig({
  entry,
  format: ["esm"],
  dts: { entry: ["src/index.ts"] },
  clean: true,
  sourcemap: true,
  target: "node20",
  splitting: false,
  banner: {
    js: "// FreeRouter — Free, self-hosted AI model router",
  },
});
