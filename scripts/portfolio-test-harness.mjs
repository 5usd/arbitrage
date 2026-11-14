// Compiles the pure-TypeScript portfolio modules to a temporary ESM folder
// with the project's own `typescript` dependency (no extra test tooling),
// so node:test can import them.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "node_modules", ".cache", "portfolio-tests");

const SOURCE_DIRS = ["lib/portfolio", "lib/market-data"];

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

export function compilePortfolioModules() {
  rmSync(outDir, { recursive: true, force: true });
  for (const srcDir of SOURCE_DIRS) {
    for (const file of walk(join(root, srcDir))) {
      if (!file.endsWith(".ts")) continue;
      const source = readFileSync(file, "utf8");
      const { outputText } = ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
          verbatimModuleSyntax: false,
        },
        fileName: file,
      });
      // Extensionless relative imports → explicit .mjs for Node ESM.
      const rewritten = outputText.replace(
        /(from\s+["'])(\.{1,2}\/[^"']+?)(["'])/g,
        (_, a, spec, b) => `${a}${spec}.mjs${b}`,
      );
      const target = join(outDir, relative(root, file)).replace(/\.ts$/, ".mjs");
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, rewritten);
    }
  }
  return (modulePath) => import(pathToFileURL(join(outDir, modulePath + ".mjs")).href);
}
