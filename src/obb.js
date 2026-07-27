// Cálculo de OBB (Oriented Bounding Box) por análise das normais dominantes
// da malha — extrai Comprimento × Largura × Espessura reais em mm, mesmo
// para peças rotacionadas no espaço. Ideal para painéis de mobiliário.
import * as THREE from 'three';

const EPS_PARALLEL = 0.9995; // cos ~1.8°
const EPS_PERP = 0.06;       // cos ~86.5°

/**
 * @param {Float32Array|number[]} pos posições xyz intercaladas (coordenadas de mundo, mm)
 * @param {Uint32Array|number[]|null} idx índices dos triângulos (ou null p/ soup)
 * @returns {{ size:[number,number,number], axes:THREE.Vector3[], center:THREE.Vector3, volume:number }}
 *   size ordenado decrescente: [Comprimento, Largura, Espessura]; axes na mesma ordem.
 */
export function computeOBB(pos, idx) {
  const triCount = idx ? idx.length / 3 : pos.length / 9;
  const buckets = []; // { axis: THREE.Vector3 (canônico), weight: number }
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3();

  const readVert = (vi, out) => out.set(pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2]);

  let volume6 = 0; // 6 × volume assinado (teorema da divergência)

  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx[t * 3] : t * 3;
    const i1 = idx ? idx[t * 3 + 1] : t * 3 + 1;
    const i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
    readVert(i0, a); readVert(i1, b); readVert(i2, c);

    volume6 += a.dot(e1.copy(b).cross(c));

    e1.copy(b).sub(a);
    e2.copy(c).sub(a);
    n.copy(e1).cross(e2);
    const area2 = n.length();
    if (area2 < 1e-9) continue;
    n.divideScalar(area2);

    // Canonicaliza o sinal para agrupar n e -n no mesmo bucket
    if (n.x < -1e-6 || (Math.abs(n.x) <= 1e-6 && n.y < -1e-6) ||
        (Math.abs(n.x) <= 1e-6 && Math.abs(n.y) <= 1e-6 && n.z < 0)) {
      n.negate();
    }

    let found = null;
    for (const bk of buckets) {
      if (bk.axis.dot(n) > EPS_PARALLEL) { found = bk; break; }
    }
    if (found) found.weight += area2;
    else buckets.push({ axis: n.clone(), weight: area2 });
  }

  const volume = Math.abs(volume6) / 6;

  let a1, a2;
  if (buckets.length) {
    buckets.sort((x, y) => y.weight - x.weight);
    a1 = buckets[0].axis.clone();
    for (const bk of buckets) {
      if (Math.abs(bk.axis.dot(a1)) < EPS_PERP) { a2 = bk.axis.clone(); break; }
    }
  } else {
    a1 = new THREE.Vector3(1, 0, 0);
  }
  if (!a2) {
    // Peça sem faces perpendiculares dominantes (cilíndrica etc.):
    // usa o eixo do mundo menos alinhado com a1
    const wx = Math.abs(a1.x), wy = Math.abs(a1.y), wz = Math.abs(a1.z);
    const w = wx <= wy && wx <= wz ? new THREE.Vector3(1, 0, 0)
      : wy <= wz ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
    a2 = w.sub(a1.clone().multiplyScalar(w.dot(a1))).normalize();
  }
  const a3 = new THREE.Vector3().crossVectors(a1, a2).normalize();
  a2 = new THREE.Vector3().crossVectors(a3, a1).normalize(); // reortogonaliza

  // Projeta todos os vértices no triedro
  const axes = [a1, a2, a3];
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.length; i += 3) {
    v.set(pos[i], pos[i + 1], pos[i + 2]);
    for (let k = 0; k < 3; k++) {
      const d = v.dot(axes[k]);
      if (d < min[k]) min[k] = d;
      if (d > max[k]) max[k] = d;
    }
  }

  const entries = axes.map((axis, k) => ({
    size: max[k] - min[k],
    mid: (max[k] + min[k]) / 2,
    axis
  }));
  entries.sort((x, y) => y.size - x.size);

  const center = new THREE.Vector3();
  for (const e of entries) center.addScaledVector(e.axis, e.mid);

  return {
    size: entries.map((e) => e.size),
    axes: entries.map((e) => e.axis),
    center,
    volume
  };
}
