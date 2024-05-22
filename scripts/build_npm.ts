// ex. scripts/build_npm.ts
import { build, emptyDir } from "@deno/dnt";

await emptyDir("./npm");

await build({
  entryPoints: ["./src/cli.ts"],
  outDir: "./npm",
  shims: {
    // see JS docs for overview and more options
    deno: true,
  },
  package: {
    // package.json properties
    name: "ledgerloops",
    version: Deno.args[0],
    description: "LedgerLoops",
    license: "MIT",
    repository: {
      type: "git",
      url: "git+https://github.com/ledgerloops/ledgerloops.git",
    },
    bugs: {
      url: "https://github.com/ledgerloops/ledgerloops/issues",
    },
  },
  postBuild() {
    // steps to run after building and before running the tests
    Deno.copyFileSync("LICENSE", "npm/LICENSE");
    Deno.copyFileSync("testnet-10.csv", "npm/testnet-10.csv");
    Deno.copyFileSync("README.md", "npm/README.md");
  },
});
