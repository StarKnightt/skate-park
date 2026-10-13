// Transpile src/**/*.ts to tools/sim/.build (ESM, .js import specifiers) so physics can run headless in node.
// node tools/sim/build_src.mjs   (then import from tools/sim/.build/...)
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..');
const src = path.join(root, 'src');
const out = path.join(root, 'tools/sim/.build');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
for (const f of walk(src).filter((f) => f.endsWith('.ts'))) {
  const code = fs.readFileSync(f, 'utf8');
  let js = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: false, isolatedModules: true },
  }).outputText;
  js = js.replace(/(from\s+['"])(\.{1,2}\/[^'"]+)(['"])/g, (m, a, p, b) => a + (p.endsWith('.js') ? p : p + '.js') + b);
  js = js.replace(/import\.meta\.env\.BASE_URL/g, "'/'");
  const o = path.join(out, path.relative(src, f)).replace(/\.ts$/, '.js');
  fs.mkdirSync(path.dirname(o), { recursive: true });
  fs.writeFileSync(o, js);
}
console.log('built', out);
