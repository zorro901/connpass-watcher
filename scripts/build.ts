import { readFileSync, writeFileSync } from "node:fs";

const result = await Bun.build({
  entrypoints: ["src/index.ts"],
  outdir: "dist",
  target: "node",
  packages: "external",
});

if (!result.success) {
  console.error("Build failed:", result.logs);
  process.exit(1);
}

// Add shebang
const outputPath = "dist/index.js";
const content = readFileSync(outputPath, "utf-8");
writeFileSync(outputPath, `#!/usr/bin/env node\n${content}`);

console.log("Build complete: dist/index.js");
