const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const ts = require("../../mobile/node_modules/typescript");
const tracked = execFileSync("git", ["diff", "--name-only", "dc46415065fac9e80200d0711b729db7f8c7d2c8"], { encoding: "utf8" });
const added = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { encoding: "utf8" });
const files = [...new Set((tracked + "\n" + added).trim().split("\n"))].filter(path => /\.tsx?$/.test(path));
let errors = 0;
for (const path of files) {
  const result = ts.transpileModule(fs.readFileSync(path, "utf8"), { fileName: path, reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  for (const diagnostic of result.diagnostics || []) {
    if (diagnostic.category === ts.DiagnosticCategory.Error) { errors++; process.stderr.write(path + ": " + ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n") + "\n"); }
  }
}
if (errors) process.exit(1);
process.stdout.write(`Syntax checked ${files.length} changed TypeScript files (no semantic typecheck).\n`);
