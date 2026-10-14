// gltf-transform (core / extensions / functions) and meshoptimizer, resolved through the @gltf-transform/cli devDependency
// (pnpm does not hoist them), plus a NodeIO with every extension and the meshopt codec registered.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cli = fs.realpathSync(path.join(root, 'node_modules/@gltf-transform/cli'));
const req = createRequire(path.join(cli, 'package.json'));
const load = async (name) => {
  // ESM-only packages: find the package folder, then its module entry
  let dir = path.dirname(req.resolve.paths(name).map((p) => path.join(p, name, 'package.json')).find((p) => fs.existsSync(p)));
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const exp = pkg.exports?.['.'] ?? pkg.exports;
  const entry = (typeof exp === 'string' ? exp : exp?.import?.default ?? exp?.import ?? exp?.default) ?? pkg.module ?? pkg.main;
  return import(pathToFileURL(path.join(dir, typeof entry === 'string' ? entry : entry.default)).href);
};

export async function gltfTransform() {
  const [core, ext, fn, mo] = await Promise.all(['@gltf-transform/core', '@gltf-transform/extensions', '@gltf-transform/functions', 'meshoptimizer'].map(load));
  await Promise.all([mo.MeshoptDecoder.ready, mo.MeshoptEncoder.ready]);
  const io = new core.NodeIO().registerExtensions(ext.ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': mo.MeshoptDecoder, 'meshopt.encoder': mo.MeshoptEncoder });
  return { core, ext, fn, io, meshopt: mo };
}
