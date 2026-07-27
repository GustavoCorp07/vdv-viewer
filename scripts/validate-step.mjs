// Valida um arquivo STEP com o mesmo kernel usado pelo app (occt-import-js):
// confere sucesso do parsing, quantidade de meshes, nomes e dimensões.
import { readFileSync } from 'fs';
import occtimportjs from 'occt-import-js';

const file = process.argv[2];
if (!file) {
  console.error('Uso: node scripts/validate-step.mjs <arquivo.step>');
  process.exit(2);
}

const occt = await occtimportjs();
const buffer = readFileSync(file);
const result = occt.ReadStepFile(new Uint8Array(buffer), {
  linearUnit: 'millimeter',
  linearDeflectionType: 'bounding_box_ratio',
  linearDeflection: 0.001,
  angularDeflection: 0.5
});

if (!result.success) {
  console.error('FALHA: o OpenCASCADE não conseguiu ler o arquivo.');
  process.exit(1);
}

console.log(`success: ${result.success}`);
console.log(`meshes:  ${result.meshes.length}`);

const dimsOf = (mesh) => {
  const p = mesh.attributes.position.array;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (p[i + k] < min[k]) min[k] = p[i + k];
      if (p[i + k] > max[k]) max[k] = p[i + k];
    }
  }
  return max.map((v, k) => (v - min[k]).toFixed(1)).join(' × ');
};

let problems = 0;
for (const mesh of result.meshes) {
  const name = (mesh.name || '').trim();
  const tris = mesh.index ? mesh.index.array.length / 3 : 0;
  const color = mesh.color ? `rgb(${mesh.color.map((c) => c.toFixed(2)).join(',')})` : 'sem cor';
  console.log(`  - "${name}"  bbox ${dimsOf(mesh)} mm  ${tris} tris  ${color}`);
  if (!name) { console.error('    ^ PROBLEMA: mesh sem nome'); problems++; }
  if (!tris) { console.error('    ^ PROBLEMA: mesh sem triângulos'); problems++; }
}

const treeNames = [];
const walk = (node, depth) => {
  treeNames.push('  '.repeat(depth) + (node.name || '(sem nome)'));
  for (const ch of node.children || []) walk(ch, depth + 1);
};
if (result.root) walk(result.root, 0);
console.log('hierarquia:');
console.log(treeNames.map((n) => '  ' + n).join('\n'));

if (problems) {
  console.error(`\n${problems} problema(s) encontrados.`);
  process.exit(1);
}
console.log('\nOK: arquivo válido para o VdvView 3D.');
