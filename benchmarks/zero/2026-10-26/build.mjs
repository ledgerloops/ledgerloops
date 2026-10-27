import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
await mkdir("dist", { recursive: true });
await build({
  entryPoints: ["client.mjs"],
  bundle: true,
  format: "iife",
  platform: "browser",
  outfile: "dist/client.js",
  define: { "process.env.NODE_ENV": '"production"' },
});
