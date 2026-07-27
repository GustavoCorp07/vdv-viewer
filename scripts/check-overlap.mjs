import { readFileSync } from 'fs';
import occtimportjs from 'occt-import-js';

const occt = await occtimportjs();
const buffer = readFileSync('D:/VdvView/ArquvioTeste.step');
const result = occt.ReadStepFile(new Uint8Array(buffer), { linearUnit: 'millimeter', linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.001, angularDeflection: 0.5 });

const boxes = result.meshes.map((m, i) => {
  const p = m.attributes.position.array;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < p.length; k += 3) for (let a = 0; a < 3; a++) {
    if (p[k + a] < min[a]) min[a] = p[k + a];
    if (p[k + a] > max[a]) max[a] = p[k + a];
  }
  return { i, min, max };
});

// nomes reais na ordem do arquivo
const txt = buffer.toString('latin1');
const names = [...txt.matchAll(/MANIFOLD_SOLID_BREP\('([^']*)'/g)].map(m => m[1]);
console.log('BREP names:', names.length, '| meshes:', result.meshes.length);

let dup = 0, ovl = 0;
for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
  const a = boxes[i], b = boxes[j];
  const same = a.min.every((v, k) => Math.abs(v - b.min[k]) < 0.01) && a.max.every((v, k) => Math.abs(v - b.max[k]) < 0.01);
  const ox = Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0]);
  const oy = Math.min(a.max[1], b.max[1]) - Math.max(a.min[1], b.min[1]);
  const oz = Math.min(a.max[2], b.max[2]) - Math.max(a.min[2], b.min[2]);
  if (same) { console.log(`DUPLICADO EXATO: #${i} "${names[i]}" == #${j} "${names[j]}"`); dup++; }
  else if (ox > 0.5 && oy > 0.5 && oz > 0.5) { console.log(`SOBREPOSTO: #${i} "${names[i]}" x #${j} "${names[j]}" -> ${ox.toFixed(1)}x${oy.toFixed(1)}x${oz.toFixed(1)}`); ovl++; }
}
console.log(`\n${dup} duplicados, ${ovl} sobreposições volumétricas`);
