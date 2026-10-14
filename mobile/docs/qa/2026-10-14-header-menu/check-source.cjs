const fs = require("node:fs");
const path = require("node:path");
const { isBuiltin } = require("node:module");
const ts = require(process.cwd() + "/mobile/node_modules/typescript");
const files = JSON.parse(
  fs.readFileSync(path.join(__dirname, "task-files.json"), "utf8"),
).filter((f) => /\.tsx?$/.test(f));
const config = ts.readConfigFile("mobile/tsconfig.json", ts.sys.readFile);
const options = ts.parseJsonConfigFileContent(
  config.config,
  ts.sys,
  path.resolve("mobile"),
).options;
let failures = [];
for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  const result = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: options,
    reportDiagnostics: true,
  });
  for (const d of result.diagnostics || [])
    if (d.category === ts.DiagnosticCategory.Error)
      failures.push(
        file + ": " + ts.flattenDiagnosticMessageText(d.messageText, " "),
      );
  for (const imp of ts.preProcessFile(source, true, true).importedFiles) {
    if (isBuiltin(imp.fileName)) continue;
    if (
      !ts.resolveModuleName(imp.fileName, path.resolve(file), options, ts.sys)
        .resolvedModule
    )
      failures.push(file + ": unresolved " + imp.fileName);
  }
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(
  files.length +
    " explicit task files: syntax and import resolution passed (not semantic typecheck)",
);
