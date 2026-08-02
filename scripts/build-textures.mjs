// Otimiza a biblioteca de texturas MDF para a web:
// máx. 1024px, JPEG q78, nomes bonitos + manifest.json para busca.
import sharp from 'sharp';
import { readdirSync, statSync, mkdirSync, writeFileSync } from 'fs';
import { join, extname, basename, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'MADEIRA E MDF', 'MADEIRA E MDF', 'MDF - FABRICANTES NACIONAIS');
const OUT = join(root, 'public', 'texturas');
mkdirSync(OUT, { recursive: true });

const slugify = (s) => s.toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const pretty = (s) => s
  .replace(/\.(jpg|jpeg|png)$/i, '')
  .replace(/_corte$/i, '')
  .replace(/[_-]+/g, ' ')
  .trim()
  .replace(/\s+/g, ' ')
  .replace(/\b\w/g, (c) => c.toUpperCase());

const entries = [];
const seen = new Set();
let done = 0, skipped = 0;

async function walk(dir, brand) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      await walk(p, brand || name);
      continue;
    }
    const ext = extname(name).toLowerCase();
    if (ext !== '.jpg' && ext !== '.jpeg' && ext !== '.png') continue;
    if (st.size < 25 * 1024) { skipped++; continue; } // logos/miniaturas
    const b = brand || 'Diversos';
    const dispName = pretty(basename(name));
    let id = slugify(b) + '--' + slugify(dispName);
    let n = 2;
    while (seen.has(id)) id = slugify(b) + '--' + slugify(dispName) + '-' + n++;
    seen.add(id);
    try {
      await sharp(p)
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 84, mozjpeg: true })
        .toFile(join(OUT, id + '.jpg'));
      entries.push({ id, name: dispName, brand: b, file: 'texturas/' + id + '.jpg' });
      done++;
    } catch (e) {
      skipped++;
    }
  }
}

await walk(SRC, null);
entries.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(entries));
console.log(`ok: ${done} texturas, ${skipped} ignoradas`);
const total = readdirSync(OUT).reduce((s, f) => s + statSync(join(OUT, f)).size, 0);
console.log(`tamanho final: ${(total / 1024 / 1024).toFixed(1)} MB`);
