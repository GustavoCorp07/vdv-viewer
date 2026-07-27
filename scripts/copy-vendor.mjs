// Copia o runtime do OpenCASCADE (WASM) para public/vendor,
// de onde é carregado pelo Web Worker e pelo fallback de thread principal.
import { mkdirSync, copyFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'occt-import-js', 'dist');
const dst = join(root, 'public', 'vendor');

if (!existsSync(src)) {
  console.error('occt-import-js não encontrado em node_modules. Rode "npm install" primeiro.');
  process.exit(1);
}
mkdirSync(dst, { recursive: true });
for (const f of ['occt-import-js.js', 'occt-import-js.wasm']) {
  copyFileSync(join(src, f), join(dst, f));
  console.log('copiado:', f);
}
