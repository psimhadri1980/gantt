// API reference generated from the TypeScript sources (J5).
//   pnpm run docs:api            writes docs/api/<package>.md for every package
//   pnpm run docs:api --check exits 1 if any file is out of date (run in CI, so the reference never drifts)
//
// For each package, the public API is what its src/index.ts exports. The TypeScript compiler resolves every
// export (including `export *` and re-exports) to its declaration; the reference lists each one with its kind,
// its declared signature and its doc comment. Nothing is hand-written, so the reference is only as good as the
// doc comments in the code.
import ts from 'typescript';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const outDir = join(root, 'docs/api');
const check = process.argv.includes('--check');

const packages = readdirSync(join(root, 'packages')).filter((p) => existsSync(join(root, 'packages', p, 'src/index.ts'))).sort();
const entries = packages.map((p) => join(root, 'packages', p, 'src/index.ts'));
const config = ts.getParsedCommandLineOfConfigFile(join(root, 'tsconfig.json'), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} });
const program = ts.createProgram(entries, { ...config.options, noEmit: true });
const checker = program.getTypeChecker();

/** The kind shown for a declaration: function, class, interface, type, const or enum. */
function kindOf(d) {
  if (ts.isFunctionDeclaration(d)) return 'function';
  if (ts.isClassDeclaration(d)) return 'class';
  if (ts.isInterfaceDeclaration(d)) return 'interface';
  if (ts.isTypeAliasDeclaration(d)) return 'type';
  if (ts.isEnumDeclaration(d)) return 'enum';
  if (ts.isVariableDeclaration(d)) return 'const';
  return ts.SyntaxKind[d.kind];
}

/** The declaration's own text without its body: what a reader needs to call or implement it. */
function signatureOf(d, name) {
  const sf = d.getSourceFile();
  if (ts.isFunctionDeclaration(d)) {
    const text = d.getText(sf);
    return d.body ? text.slice(0, d.body.getStart(sf) - d.getStart(sf)).trim() : text;
  }
  if (ts.isClassDeclaration(d)) {
    // Public members only, without bodies.
    const members = d.members.filter((m) => !(ts.getCombinedModifierFlags(m) & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) && !(m.name && ts.isPrivateIdentifier(m.name)))
      .map((m) => {
        const t = m.getText(sf);
        const body = m.body ?? (ts.isPropertyDeclaration(m) ? m.initializer : undefined);
        return '  ' + (body ? t.slice(0, body.getStart(sf) - m.getStart(sf)).replace(/\s*=?\s*$/, '') : t).replace(/\s+/g, ' ').trim();
      });
    const head = d.getText(sf).slice(0, d.members.pos - d.getStart(sf)).replace(/\{\s*$/, '').trim();
    return `${head} {\n${members.join('\n')}\n}`;
  }
  if (ts.isVariableDeclaration(d)) {
    // Constants show their type, not their (often long) value.
    const type = checker.typeToString(checker.getTypeAtLocation(d.name), d, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseSingleQuotesForStringLiteralType);
    // import("…/node_modules/@types/react/index").X → React.X, so no machine-specific path ends up in the docs.
    const clean = type.replace(/import\("[^"]*\/@types\/react\/index"\)\./g, 'React.').replace(/import\("[^"]*"\)\./g, '');
    return `const ${name}: ${clean.length > 400 ? clean.slice(0, 400) + ' …' : clean}`;
  }
  return d.getText(sf);
}

/** The doc comment above the declaration (for a const, above its statement). */
function docOf(d, symbol) {
  const text = ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim();
  if (text) return text;
  const node = ts.isVariableDeclaration(d) ? d.parent.parent : d;
  const ranges = ts.getLeadingCommentRanges(d.getSourceFile().text, node.pos) ?? [];
  const last = ranges.at(-1);
  if (!last) return '';
  const raw = d.getSourceFile().text.slice(last.pos, last.end);
  return raw.startsWith('/**') ? raw.replace(/^\/\*\*|\*\/$/g, '').split('\n').map((l) => l.replace(/^\s*\* ?/, '')).join('\n').trim() : '';
}

let stale = 0;
if (!check) mkdirSync(outDir, { recursive: true });
const index = ['# API reference', '', 'Generated from the TypeScript sources by `pnpm run docs:api`; do not edit by hand.', ''];
for (const [i, pkg] of packages.entries()) {
  const sf = program.getSourceFile(entries[i]);
  const moduleSymbol = checker.getSymbolAtLocation(sf);
  const exports = moduleSymbol ? checker.getExportsOfModule(moduleSymbol) : [];
  const pkgJson = JSON.parse(readFileSync(join(root, 'packages', pkg, 'package.json'), 'utf8'));
  const lines = [`# ${pkgJson.name}`, '', pkgJson.description ?? '', '', 'Generated from the TypeScript sources by `pnpm run docs:api`; do not edit by hand.', ''];
  const items = [];
  for (const ex of exports) {
    const sym = ex.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(ex) : ex;
    for (const d of sym.declarations ?? []) {
      if (ts.isModuleDeclaration(d) || ts.isSourceFile(d)) continue;
      items.push({ name: ex.name, kind: kindOf(d), sig: signatureOf(d, ex.name), doc: docOf(d, sym), file: relative(root, d.getSourceFile().fileName) });
      break; // overloads and merged declarations: the first is enough for the reference
    }
  }
  items.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)); // code-unit order: the same on every machine and locale
  lines.push(`${items.length} exports.`, '');
  for (const it of items) {
    lines.push(`## ${it.name}`, '', `*${it.kind}* · [${it.file}](../../${it.file})`, '');
    if (it.doc) lines.push(it.doc, '');
    lines.push('```ts', it.sig, '```', '');
  }
  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n');
  const file = join(outDir, `${pkg}.md`);
  index.push(`- [${pkgJson.name}](${pkg}.md): ${items.length} exports`);
  if (check) { if (!existsSync(file) || readFileSync(file, 'utf8') !== text) { console.error(`out of date: ${relative(root, file)}`); stale++; } }
  else writeFileSync(file, text);
}
const indexText = index.join('\n') + '\n';
const indexFile = join(outDir, 'README.md');
if (check) { if (!existsSync(indexFile) || readFileSync(indexFile, 'utf8') !== indexText) { console.error('out of date: docs/api/README.md'); stale++; } }
else writeFileSync(indexFile, indexText);
if (check && stale) { console.error('Run `pnpm run docs:api` and commit the result.'); process.exit(1); }
console.log(check ? 'API reference is up to date.' : `Wrote docs/api for ${packages.length} packages.`);
