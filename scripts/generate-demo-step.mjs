// Gera o modelo de demonstração: um gabinete de marcenaria em STEP AP214
// com 8 peças nomeadas (sólidos B-Rep independentes) e cores.
// Saída: public/demo/demo-gabinete.step
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------- Peças do gabinete (mm): [x0,x1, y0,y1, z0,z1] ----------
// Convenção: X = largura, Y = profundidade (frente = -Y), Z = altura.
const PARTS = [
  { name: 'Lateral Esquerda', box: [0, 18, 0, 350, 0, 720], color: [0.784, 0.604, 0.392] },
  { name: 'Lateral Direita',  box: [582, 600, 0, 350, 0, 720], color: [0.784, 0.604, 0.392] },
  { name: 'Base',             box: [18, 582, 0, 350, 0, 18], color: [0.824, 0.663, 0.451] },
  { name: 'Topo',             box: [18, 582, 0, 350, 702, 720], color: [0.824, 0.663, 0.451] },
  { name: 'Fundo',            box: [18, 582, 344, 350, 18, 702], color: [0.878, 0.784, 0.639] },
  { name: 'Prateleira Inferior', box: [18, 582, 10, 340, 251, 269], color: [0.851, 0.722, 0.514] },
  { name: 'Prateleira Superior', box: [18, 582, 10, 340, 451, 469], color: [0.851, 0.722, 0.514] },
  { name: 'Porta',            box: [2, 598, -21, -3, 2, 718], color: [0.663, 0.502, 0.357] }
];

// ---------- Escritor de entidades ----------
let id = 0;
const lines = [];
const E = (text) => {
  const n = ++id;
  lines.push(`#${n}=${text};`);
  return `#${n}`;
};
const num = (v) => {
  if (Number.isInteger(v)) return v.toFixed(1);
  return String(Math.round(v * 1e6) / 1e6);
};
const pt = (x, y, z) => E(`CARTESIAN_POINT('',(${num(x)},${num(y)},${num(z)}))`);
const dir = (x, y, z) => E(`DIRECTION('',(${num(x)},${num(y)},${num(z)}))`);

// ---------- Contextos globais ----------
const app = E(`APPLICATION_CONTEXT('automotive design')`);
E(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2010,${app})`);
const prodCtx = E(`PRODUCT_CONTEXT('',${app},'mechanical')`);
const pdefCtx = E(`PRODUCT_DEFINITION_CONTEXT('part definition',${app},'design')`);

const lenUnit = E(`(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))`);
const angUnit = E(`(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))`);
const saUnit = E(`(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())`);
const tol = E(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(0.01),${lenUnit},'distance_accuracy_value','')`);
const geomCtx = E(
  `(GEOMETRIC_REPRESENTATION_CONTEXT(3)` +
  `GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${tol}))` +
  `GLOBAL_UNIT_ASSIGNED_CONTEXT((${lenUnit},${angUnit},${saUnit}))` +
  `REPRESENTATION_CONTEXT('Context #1','3D Context'))`
);

// ---------- Construção de uma caixa B-Rep ----------
function buildBox([x0, x1, y0, y1, z0, z1]) {
  // 8 vértices
  const corners = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]
  ];
  const cps = corners.map((c) => pt(...c));
  const vps = cps.map((cp) => E(`VERTEX_POINT('',${cp})`));

  // 12 arestas canônicas: [vStart, vEnd]
  const EDGES = [
    [0, 1], [1, 2], [2, 3], [3, 0],   // base (z0)
    [4, 5], [5, 6], [6, 7], [7, 4],   // topo (z1)
    [0, 4], [1, 5], [2, 6], [3, 7]    // verticais
  ];
  const edgeCurves = EDGES.map(([a, b]) => {
    const pa = corners[a], pb = corners[b];
    const d = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
    const len = Math.hypot(...d);
    const u = d.map((v) => v / len);
    const lineDir = dir(...u);
    const vec = E(`VECTOR('',${lineDir},1.0)`);
    const line = E(`LINE('',${cps[a]},${vec})`);
    return E(`EDGE_CURVE('',${vps[a]},${vps[b]},${line},.T.)`);
  });

  // 6 faces: { loop: [[edgeIdx, forward]], normal, refDir, origin (índice de canto) }
  const FACES = [
    { loop: [[3, false], [2, false], [1, false], [0, false]], n: [0, 0, -1], r: [1, 0, 0], o: 0 }, // base
    { loop: [[4, true], [5, true], [6, true], [7, true]], n: [0, 0, 1], r: [1, 0, 0], o: 4 },      // topo
    { loop: [[0, true], [9, true], [4, false], [8, false]], n: [0, -1, 0], r: [1, 0, 0], o: 0 },   // frente
    { loop: [[2, true], [11, true], [6, false], [10, false]], n: [0, 1, 0], r: [-1, 0, 0], o: 2 }, // trás
    { loop: [[8, true], [7, false], [11, false], [3, true]], n: [-1, 0, 0], r: [0, 0, 1], o: 0 },  // esquerda
    { loop: [[1, true], [10, true], [5, false], [9, false]], n: [1, 0, 0], r: [0, 1, 0], o: 1 }    // direita
  ];

  const faceIds = FACES.map((f) => {
    const oes = f.loop.map(([ei, fwd]) =>
      E(`ORIENTED_EDGE('',*,*,${edgeCurves[ei]},${fwd ? '.T.' : '.F.'})`));
    const loop = E(`EDGE_LOOP('',(${oes.join(',')}))`);
    const bound = E(`FACE_OUTER_BOUND('',${loop},.T.)`);
    const loc = pt(...corners[f.o]);
    const ax = dir(...f.n);
    const ref = dir(...f.r);
    const place = E(`AXIS2_PLACEMENT_3D('',${loc},${ax},${ref})`);
    const plane = E(`PLANE('',${place})`);
    return E(`ADVANCED_FACE('',(${bound}),${plane},.T.)`);
  });

  const shell = E(`CLOSED_SHELL('',(${faceIds.join(',')}))`);
  return shell;
}

// ---------- Produtos ----------
const styledItems = [];
for (const part of PARTS) {
  const name = part.name.replace(/'/g, '');
  const prod = E(`PRODUCT('${name}','${name}','',(${prodCtx}))`);
  E(`PRODUCT_RELATED_PRODUCT_CATEGORY('part','',(${prod}))`);
  const pdf = E(`PRODUCT_DEFINITION_FORMATION('','',${prod})`);
  const pd = E(`PRODUCT_DEFINITION('design','',${pdf},${pdefCtx})`);
  const pds = E(`PRODUCT_DEFINITION_SHAPE('','',${pd})`);

  const shell = buildBox(part.box);
  const brep = E(`MANIFOLD_SOLID_BREP('${name}',${shell})`);

  const origin = pt(0, 0, 0);
  const az = dir(0, 0, 1);
  const rf = dir(1, 0, 0);
  const place = E(`AXIS2_PLACEMENT_3D('',${origin},${az},${rf})`);
  const shapeRep = E(`ADVANCED_BREP_SHAPE_REPRESENTATION('${name}',(${place},${brep}),${geomCtx})`);
  E(`SHAPE_DEFINITION_REPRESENTATION(${pds},${shapeRep})`);

  // cor
  const [r, g, b] = part.color;
  const col = E(`COLOUR_RGB('',${num(r)},${num(g)},${num(b)})`);
  const fac = E(`FILL_AREA_STYLE_COLOUR('',${col})`);
  const fs = E(`FILL_AREA_STYLE('',(${fac}))`);
  const sfa = E(`SURFACE_STYLE_FILL_AREA(${fs})`);
  const sss = E(`SURFACE_SIDE_STYLE('',(${sfa}))`);
  const ssu = E(`SURFACE_STYLE_USAGE(.BOTH.,${sss})`);
  const psa = E(`PRESENTATION_STYLE_ASSIGNMENT((${ssu}))`);
  styledItems.push(E(`STYLED_ITEM('',(${psa}),${brep})`));
}
E(`MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION('',(${styledItems.join(',')}),${geomCtx})`);

// ---------- Arquivo ----------
const header = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('VdvView 3D - Gabinete de demonstracao'),'2;1');
FILE_NAME('demo-gabinete.step','2026-01-01T00:00:00',('VdvView'),('VdvView'),
'VdvView 3D','VdvView 3D','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));
ENDSEC;
DATA;
`;
const footer = `ENDSEC;
END-ISO-10303-21;
`;

const out = header + lines.join('\n') + '\n' + footer;
const outDir = join(root, 'public', 'demo');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, 'demo-gabinete.step');
writeFileSync(outFile, out, 'latin1');
console.log(`Gerado: ${outFile} (${lines.length} entidades, ${PARTS.length} peças)`);
