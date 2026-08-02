// Medição profissional com SNAP inteligente (padrão SolidWorks/Fusion):
//   • o cursor "gruda" em vértices, meios de aresta, arestas e faces;
//   • clique numa ARESTA → comprimento instantâneo;
//   • clique numa FACE → área instantânea (e vira 1º alvo de par);
//   • dois alvos → distância ponto-ponto, ponto-face, face-face
//     (paralelas = distância; inclinadas = ângulo), sempre com ΔXYZ.
import * as THREE from 'three';
import { fmt } from './utils.js';

const SNAP_PX = 12;
const COLORS = {
  vertex: 0x22c55e, mid: 0xeab308, edge: 0x3b82f6, face: 0xe8792b
};

export class MeasureTool {
  constructor(app) {
    this.app = app;
    this.viewer = app.viewer;
    this.labelsEl = document.getElementById('measure-labels');
    this.snapTip = document.getElementById('snap-tip');
    this.measurements = [];
    this.pending = null;       // { kind:'point'|'face', ... }
    this.snap = null;
    this._edgeCache = new Map();

    this.marker = new THREE.Mesh(
      new THREE.SphereGeometry(1, 14, 10),
      new THREE.MeshBasicMaterial({ color: 0x22c55e, depthTest: false }));
    this.marker.renderOrder = 999;
    this.marker.visible = false;
    this.viewer.overlayGroup.add(this.marker);

    this.pendingMarker = this.marker.clone();
    this.pendingMarker.material = this.marker.material.clone();
    this.pendingMarker.material.color.setHex(0xff5d5d);
    this.pendingMarker.visible = false;
    this.viewer.overlayGroup.add(this.pendingMarker);

    this.viewer.onFrame(() => this._updateFrame());
  }

  // ---------------- Arestas mescladas por componente ----------------
  _edgesFor(comp) {
    let data = this._edgeCache.get(comp.id);
    if (data) return data;
    const pos = comp.edges.geometry.attributes.position;
    let segs = [];
    for (let i = 0; i < pos.count; i += 2) {
      const a = new THREE.Vector3().fromBufferAttribute(pos, i);
      const b = new THREE.Vector3().fromBufferAttribute(pos, i + 1);
      if (a.distanceToSquared(b) > 0.01) segs.push({ a, b });
    }
    // funde segmentos colineares encadeados → arestas completas
    let merged = true;
    while (merged) {
      merged = false;
      outer:
      for (let i = 0; i < segs.length; i++) {
        const s1 = segs[i];
        const d1 = s1.b.clone().sub(s1.a).normalize();
        for (let j = i + 1; j < segs.length; j++) {
          const s2 = segs[j];
          const d2 = s2.b.clone().sub(s2.a).normalize();
          if (Math.abs(d1.dot(d2)) < 0.9995) continue;
          let joined = null;
          if (s1.b.distanceTo(s2.a) < 0.05) joined = { a: s1.a, b: s2.b };
          else if (s1.b.distanceTo(s2.b) < 0.05) joined = { a: s1.a, b: s2.a };
          else if (s1.a.distanceTo(s2.a) < 0.05) joined = { a: s1.b, b: s2.b };
          else if (s1.a.distanceTo(s2.b) < 0.05) joined = { a: s1.b, b: s2.a };
          if (!joined) continue;
          const dj = joined.b.clone().sub(joined.a).normalize();
          if (Math.abs(dj.dot(d1)) < 0.9995) continue;
          segs.splice(j, 1);
          segs[i] = joined;
          merged = true;
          break outer;
        }
      }
    }
    const vertices = [];
    const seen = new Set();
    for (const s of segs) {
      for (const p of [s.a, s.b]) {
        const k = `${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}`;
        if (!seen.has(k)) { seen.add(k); vertices.push(p); }
      }
    }
    data = { segs, vertices };
    this._edgeCache.set(comp.id, data);
    return data;
  }

  _toScreen(world) {
    const rect = this.viewer.renderer.domElement.getBoundingClientRect();
    const v = world.clone().project(this.viewer.camera);
    return {
      x: rect.left + (v.x + 1) / 2 * rect.width,
      y: rect.top + (-v.y + 1) / 2 * rect.height,
      behind: v.z > 1
    };
  }

  // ---------------- Snap (hover) ----------------
  onHover(pos, hit) {
    if (!hit) { this._setSnap(null, pos); return; }
    const comp = hit.comp;
    const off = comp.group.position;
    const { segs, vertices } = this._edgesFor(comp);
    const cursor = { x: pos.clientX, y: pos.clientY };
    const d2 = (s) => (s.x - cursor.x) ** 2 + (s.y - cursor.y) ** 2;

    // 1) vértices
    let best = null, bestD = SNAP_PX * SNAP_PX;
    for (const v of vertices) {
      const w = v.clone().add(off);
      const s = this._toScreen(w);
      if (s.behind) continue;
      const dd = d2(s);
      if (dd < bestD) { bestD = dd; best = { type: 'vertex', point: w, comp }; }
    }
    if (best) { this._setSnap(best, pos); return; }

    // 2) meios de aresta
    bestD = SNAP_PX * SNAP_PX;
    for (const seg of segs) {
      const mid = seg.a.clone().add(seg.b).multiplyScalar(0.5).add(off);
      const s = this._toScreen(mid);
      if (s.behind) continue;
      const dd = d2(s);
      if (dd < bestD) {
        bestD = dd;
        best = { type: 'mid', point: mid, comp, edgeLen: seg.a.distanceTo(seg.b) };
      }
    }
    if (best) { this._setSnap(best, pos); return; }

    // 3) arestas (ponto mais próximo sobre o segmento)
    bestD = 10 * 10;
    const line = new THREE.Line3();
    const tmp = new THREE.Vector3();
    for (const seg of segs) {
      line.set(seg.a.clone().add(off), seg.b.clone().add(off));
      line.closestPointToPoint(hit.point, true, tmp);
      const s = this._toScreen(tmp);
      if (s.behind) continue;
      const dd = d2(s);
      if (dd < bestD) {
        bestD = dd;
        best = {
          type: 'edge', point: tmp.clone(), comp,
          edgeA: line.start.clone(), edgeB: line.end.clone(),
          edgeLen: line.distance()
        };
      }
    }
    if (best) { this._setSnap(best, pos); return; }

    // 4) face
    const face = this._faceInfo(comp, hit);
    this._setSnap({ type: 'face', point: hit.point.clone(), comp, ...face }, pos);
  }

  /** Plano + área da face planar sob o hit. */
  _faceInfo(comp, hit) {
    const geo = comp.mesh.geometry;
    const posA = geo.attributes.position;
    const idx = geo.index;
    const off = comp.group.position;
    const n = hit.face.normal.clone().transformDirection(comp.mesh.matrixWorld).normalize();
    const d = n.dot(hit.point);
    // área: soma dos triângulos coplanares (base local: descontar offset)
    const dLocal = n.dot(hit.point.clone().sub(off));
    let area = 0;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const ab = new THREE.Vector3(), ac = new THREE.Vector3(), cr = new THREE.Vector3();
    const triCount = idx ? idx.count / 3 : posA.count / 3;
    for (let t = 0; t < triCount; t++) {
      const i0 = idx ? idx.getX(t * 3) : t * 3;
      const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      a.fromBufferAttribute(posA, i0);
      b.fromBufferAttribute(posA, i1);
      c.fromBufferAttribute(posA, i2);
      ab.copy(b).sub(a); ac.copy(c).sub(a);
      cr.copy(ab).cross(ac);
      const triArea = cr.length() / 2;
      if (triArea < 1e-6) continue;
      cr.normalize();
      if (Math.abs(cr.dot(n)) < 0.999) continue;
      if (Math.abs(n.dot(a) - dLocal) > 0.8) continue;
      area += triArea;
    }
    return { normal: n, planeD: d, area };
  }

  _setSnap(snap, pos) {
    this.snap = snap;
    if (!snap) {
      this.marker.visible = false;
      this.snapTip.classList.add('hidden');
      return;
    }
    const dist = this.viewer.controls.distance;
    this.marker.visible = true;
    this.marker.position.copy(snap.point);
    this.marker.scale.setScalar(Math.max(dist * 0.006, 1.2));
    this.marker.material.color.setHex(COLORS[snap.type]);

    const texts = {
      vertex: () => '◆ Vértice',
      mid: () => `◈ Meio da aresta (${fmt(snap.edgeLen ?? 0, 1)} mm)`,
      edge: () => `━ Aresta: ${fmt(snap.edgeLen ?? 0, 1)} mm — clique para medir`,
      face: () => `▢ Face: ${fmt((snap.area || 0) / 1e6, 3)} m²`
    };
    this.snapTip.textContent = texts[snap.type]();
    this.snapTip.style.borderLeftColor =
      '#' + new THREE.Color(COLORS[snap.type]).getHexString();
    const wrap = this.viewer.container.getBoundingClientRect();
    this.snapTip.style.left = pos.clientX - wrap.left + 16 + 'px';
    this.snapTip.style.top = pos.clientY - wrap.top + 22 + 'px';
    this.snapTip.classList.remove('hidden');
  }

  // ---------------- Cliques ----------------
  onClick(hit) {
    if (!hit) return;
    if (!this.snap || this.snap.comp !== hit.comp) {
      // garante snap coerente mesmo em clique sem hover prévio
      const face = this._faceInfo(hit.comp, hit);
      this.snap = { type: 'face', point: hit.point.clone(), comp: hit.comp, ...face };
    }
    const s = this.snap;

    if (s.type === 'edge') {
      this._addEdgeMeasurement(s);
      return;
    }
    if (s.type === 'face' && !this.pending) {
      this._addAreaMeasurement(s);
      this.pending = { kind: 'face', normal: s.normal, planeD: s.planeD, point: s.point.clone() };
      this.pendingMarker.visible = true;
      this.pendingMarker.position.copy(s.point);
      this.pendingMarker.scale.copy(this.marker.scale);
      this.app.setStatus(
        'Face marcada — clique noutra FACE (distância/ângulo) ou num PONTO (distância perpendicular)');
      return;
    }

    const isPoint = s.type === 'vertex' || s.type === 'mid' ||
      (s.type === 'face' && this.pending);
    if (!this.pending) {
      this.pending = { kind: 'point', point: s.point.clone() };
      this.pendingMarker.visible = true;
      this.pendingMarker.position.copy(s.point);
      this.pendingMarker.scale.copy(this.marker.scale);
      this.app.setStatus('1º ponto marcado — clique no segundo alvo…');
      return;
    }

    // resolve o par
    const p = this.pending;
    this.pending = null;
    this.pendingMarker.visible = false;
    if (p.kind === 'point' && isPoint && s.type !== 'face') {
      this._addDistanceMeasurement(p.point, s.point);
    } else if (p.kind === 'point') {
      this._addPointFaceMeasurement(p.point, s);
    } else if (p.kind === 'face' && s.type === 'face') {
      this._addFaceFaceMeasurement(p, s);
    } else if (p.kind === 'face') {
      this._addPointFaceMeasurement(s.point, p);
    }
  }

  // ---------------- Criação de medições ----------------
  _mkLabel(html, anchor) {
    const label = document.createElement('div');
    label.className = 'measure-label';
    label.innerHTML = html;
    this.labelsEl.appendChild(label);
    return { label, anchor: anchor.clone() };
  }

  _mkLine(a, b, color = 0xe8792b) {
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const line = new THREE.Line(geo,
      new THREE.LineBasicMaterial({ color, depthTest: false }));
    line.renderOrder = 998;
    this.viewer.overlayGroup.add(line);
    return line;
  }

  _mkDot(p, color) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 8),
      new THREE.MeshBasicMaterial({ color, depthTest: false }));
    m.renderOrder = 999;
    m.position.copy(p);
    m.scale.setScalar(Math.max(this.viewer.controls.distance * 0.005, 1));
    this.viewer.overlayGroup.add(m);
    return m;
  }

  _push(objs, labelInfo, statusText) {
    this.measurements.push({ objs, ...labelInfo });
    if (this.measurements.length > 10) this._remove(this.measurements.shift());
    if (statusText) this.app.setStatus(statusText + ' — continue medindo ou Esc para limpar');
  }

  _addDistanceMeasurement(a, b) {
    const d = a.distanceTo(b);
    const objs = [this._mkLine(a, b), this._mkDot(a, 0x22c55e), this._mkDot(b, 0x22c55e)];
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const html =
      `<b>${fmt(d, 1)} mm</b><br/>` +
      `ΔX ${fmt(Math.abs(b.x - a.x), 1)} · ΔY ${fmt(Math.abs(b.y - a.y), 1)} · ` +
      `ΔZ ${fmt(Math.abs(b.z - a.z), 1)}`;
    this._push(objs, this._mkLabel(html, mid), `Distância: ${fmt(d, 1)} mm`);
  }

  _addEdgeMeasurement(s) {
    const objs = [
      this._mkLine(s.edgeA, s.edgeB, 0x3b82f6),
      this._mkDot(s.edgeA, 0x3b82f6), this._mkDot(s.edgeB, 0x3b82f6)];
    const mid = s.edgeA.clone().add(s.edgeB).multiplyScalar(0.5);
    this._push(objs,
      this._mkLabel(`━ Aresta<br/><b>${fmt(s.edgeLen, 1)} mm</b>`, mid),
      `Aresta: ${fmt(s.edgeLen, 1)} mm`);
  }

  _addAreaMeasurement(s) {
    const objs = [this._mkDot(s.point, 0xe8792b)];
    this._push(objs,
      this._mkLabel(`▢ Face<br/><b>${fmt(s.area / 1e6, 3)} m²</b>`, s.point),
      `Área da face: ${fmt(s.area / 1e6, 3)} m²`);
  }

  _addPointFaceMeasurement(point, face) {
    const dist = Math.abs(face.normal.dot(point) - face.planeD);
    const foot = point.clone().sub(
      face.normal.clone().multiplyScalar(face.normal.dot(point) - face.planeD));
    const objs = [this._mkLine(point, foot, 0xa855f7),
      this._mkDot(point, 0xa855f7), this._mkDot(foot, 0xa855f7)];
    const mid = point.clone().add(foot).multiplyScalar(0.5);
    this._push(objs,
      this._mkLabel(`⊥ Ponto → face<br/><b>${fmt(dist, 1)} mm</b>`, mid),
      `Distância perpendicular: ${fmt(dist, 1)} mm`);
  }

  _addFaceFaceMeasurement(f1, f2) {
    const dot = Math.abs(f1.normal.dot(f2.normal));
    if (dot > 0.995) {
      const d1 = f1.normal.dot(f1.point);
      const dist = Math.abs(f2.normal.dot(f2.point) * Math.sign(f1.normal.dot(f2.normal)) - d1);
      const foot = f1.point.clone().sub(
        f2.normal.clone().multiplyScalar(f2.normal.dot(f1.point) - f2.planeD));
      const objs = [this._mkLine(f1.point, foot, 0x06b6d4),
        this._mkDot(f1.point, 0x06b6d4), this._mkDot(foot, 0x06b6d4)];
      const mid = f1.point.clone().add(foot).multiplyScalar(0.5);
      const real = f1.point.distanceTo(foot);
      this._push(objs,
        this._mkLabel(`∥ Entre faces<br/><b>${fmt(real, 1)} mm</b>`, mid),
        `Distância entre faces paralelas: ${fmt(real, 1)} mm`);
    } else {
      const ang = THREE.MathUtils.radToDeg(
        Math.acos(THREE.MathUtils.clamp(dot, -1, 1)));
      const objs = [this._mkDot(f1.point, 0x06b6d4), this._mkDot(f2.point, 0x06b6d4),
        this._mkLine(f1.point, f2.point, 0x06b6d4)];
      const mid = f1.point.clone().add(f2.point).multiplyScalar(0.5);
      this._push(objs,
        this._mkLabel(`∠ Entre faces<br/><b>${fmt(ang, 1).replace(',0', '')}°</b>`, mid),
        `Ângulo entre faces: ${fmt(ang, 1)}°`);
    }
  }

  // ---------------- Ciclo de vida ----------------
  _remove(m) {
    for (const o of m.objs) {
      this.viewer.overlayGroup.remove(o);
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    }
    m.label.remove();
  }

  clear() {
    for (const m of this.measurements) this._remove(m);
    this.measurements = [];
    this.pending = null;
    this.pendingMarker.visible = false;
    this.marker.visible = false;
    this.snapTip.classList.add('hidden');
    this._edgeCache.clear();
  }

  _updateFrame() {
    for (const m of this.measurements) {
      const s = this._toScreen(m.anchor);
      if (s.behind) { m.label.style.display = 'none'; continue; }
      m.label.style.display = '';
      const wrap = this.labelsEl.getBoundingClientRect();
      m.label.style.left = s.x - wrap.left + 'px';
      m.label.style.top = s.y - wrap.top + 'px';
    }
  }
}
