const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const dictionary = JSON.parse(
  fs.readFileSync(path.join(root, "app/src/locales/zh-CN.json"), "utf8"),
);
const properties = new Set([
  "to",
  "method",
  "url",
  "endpoint",
  "type",
  "id",
  "slug",
  "key",
  "name",
  "provider",
  "credentials",
]);
const attributes = new Set([
  "name",
  "id",
  "type",
  "value",
  "data-testid",
  "href",
  "to",
]);

function contracts(source, filename) {
  const tree = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const literals = [];
  function visit(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const parent = node.parent;
      const isContract =
        ts.isImportDeclaration(parent) ||
        ts.isExportDeclaration(parent) ||
        ts.isLiteralTypeNode(parent) ||
        ts.isCaseClause(parent) ||
        (ts.isBinaryExpression(parent) &&
          [
            ts.SyntaxKind.EqualsEqualsEqualsToken,
            ts.SyntaxKind.ExclamationEqualsEqualsToken,
            ts.SyntaxKind.EqualsEqualsToken,
            ts.SyntaxKind.ExclamationEqualsToken,
          ].includes(parent.operatorToken.kind)) ||
        (ts.isPropertyAssignment(parent) &&
          properties.has(parent.name.getText().replace(/['"]/g, ""))) ||
        (ts.isJsxAttribute(parent) && attributes.has(parent.name.getText())) ||
        (ts.isCallExpression(parent) &&
          /^(fetch|createFileRoute|client|tryClient)$/.test(
            parent.expression.getText(),
          )) ||
        /^\/api\//.test(node.text);
      if (isContract) literals.push(node.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return literals.sort();
}

// Reviewed runtime-mode additions: retain every original contract and permit only this exact
// multiset, so the localization guard still rejects removed, rewritten, or extra contract values.
const approvedContractAdditions = {
  "app/src/lib/deployment/queries.ts": [
    "boolean",
    "intelligence",
    "intelligence",
    "intelligence",
    "local",
    "local",
    "local",
  ],
  "app/src/routes/_authed/admin/learning.tsx": [
    "/admin/skills",
    "@/lib/deployment/queries",
    "local",
  ],
};

const changed = execFileSync("git", ["diff", "--name-only", "--", "app/src"], {
  cwd: root,
  encoding: "utf8",
})
  .trim()
  .split(/\r?\n/)
  .filter((name) => /\.tsx?$/.test(name));
for (const filename of changed) {
  const before = execFileSync("git", ["show", `HEAD:${filename}`], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  const after = fs.readFileSync(path.join(root, filename), "utf8");
  const expected = [
    ...contracts(before, filename),
    ...(approvedContractAdditions[filename] ?? []),
  ].sort();
  if (
    JSON.stringify(expected) !==
    JSON.stringify(contracts(after, filename))
  ) {
    throw new Error(
      `A route, identifier, type or comparison changed in ${filename}`,
    );
  }
}
let chinese = 0;
for (const [english, translated] of Object.entries(dictionary)) {
  if (typeof translated !== "string" || !translated.trim())
    throw new Error(`Empty translation: ${english}`);
  for (const pattern of [
    /__VAR_\d+__/g,
    /\b(?:[A-Z][A-Z0-9]*_[A-Z0-9_]+|SCIM|SAML|HTTPS|HTML|JSON|OTLP|HTTP|CSS|SIEM)\b/g,
    /https?:\/\/[^\s"'<>]+/g,
  ]) {
    const before = (english.match(pattern) ?? []).sort();
    const after = (translated.match(pattern) ?? []).sort();
    if (JSON.stringify(before) !== JSON.stringify(after))
      throw new Error(`Technical token changed: ${english}`);
  }
  if (/[\u3400-\u9fff]/.test(translated)) chinese++;
}
if (
  !fs
    .readFileSync(path.join(root, "app/index.html"), "utf8")
    .includes('lang="zh-CN"')
)
  throw new Error("HTML locale was not set.");
console.log(
  JSON.stringify(
    {
      translations: Object.keys(dictionary).length,
      chinese,
      contractFilesVerified: changed.length,
    },
    null,
    2,
  ),
);
