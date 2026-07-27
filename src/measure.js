// Medição ponto-a-ponto: distância real em mm entre dois pontos clicados
// na geometria, com ΔX/ΔY/ΔZ e etiqueta 3D flutuante.
import * as THREE from 'three';
import { fmt } from './utils.js';

export class MeasureTool {
  constructor(app) {
    this.app = app;
    this.viewer = app.viewer;
    this.labelsEl = document.getElementById('measure-labels');
    this.points = [];
    this.markers = [];
    this.line = null;
    this.label = null;
    this.viewer.onFrame(() => this._updateLabel());
  }

  _makeMarker(point) {
    const size = Math.max(this.viewer.controls.distance * 0.006, 1.2);
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(size, 14, 10),
      new THREE.MeshBasicMaterial({ color: 0xe8792b, depthTest: false })
    );
    m.renderOrder = 999;
    m.position.copy(point);
    this.viewer.overlayGroup.add(m);
    this.markers.push(m);
  }

  /** Snap ao vértice mais próximo do triângulo atingido (se estiver perto). */
  _snapPoint(hit) {
    const geo = hit.object.userData.comp.mesh.geometry;
    const posAttr = geo.attributes.position;
    const idx = geo.index;
    if (hit.faceIndex == null) return hit.point;
    const world = hit.point;
    let best = null, bestD = Infinity;
    for (let k = 0; k < 3; k++) {
      const vi = idx ? idx.getX(hit.faceIndex * 3 + k) : hit.faceIndex * 3 + k;
      const v = new THREE.Vector3().fromBufferAttribute(posAttr, vi)
        .add(hit.object.userData.comp.group.position);
      const d = v.distanceTo(world);
      if (d < bestD) { bestD = d; best = v; }
    }
    const snapDist = this.viewer.controls.distance * 0.02;
    return best && bestD < snapDist ? best : world;
  }

  onClick(hit) {
    if (!hit) return;
    const p = this._snapPoint(hit);
    if (this.points.length >= 2) this.clear();
    this.points.push(p);
    this._makeMarker(p);

    if (this.points.length === 2) {
      const [a, b] = this.points;
      const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
      this.line = new THREE.Line(geo,
        new THREE.LineBasicMaterial({ color: 0xe8792b, depthTest: false }));
      this.line.renderOrder = 998;
      this.viewer.overlayGroup.add(this.line);

      const d = a.distanceTo(b);
      const label = document.createElement('div');
      label.className = 'measure-label';
      label.innerHTML =
        `<b>${fmt(d, 1)} mm</b><br/>` +
        `ΔX ${fmt(Math.abs(b.x - a.x), 1)} · ` +
        `ΔY ${fmt(Math.abs(b.y - a.y), 1)} · ` +
        `ΔZ ${fmt(Math.abs(b.z - a.z), 1)}`;
      this.labelsEl.appendChild(label);
      this.label = label;
      this.app.setStatus(
        `Distância: ${fmt(d, 1)} mm  (ΔX ${fmt(Math.abs(b.x - a.x), 1)} · ` +
        `ΔY ${fmt(Math.abs(b.y - a.y), 1)} · ΔZ ${fmt(Math.abs(b.z - a.z), 1)}) — ` +
        'clique para nova medição');
    } else {
      this.app.setStatus('Medir: clique no segundo ponto…');
    }
  }

  _updateLabel() {
    if (!this.label || this.points.length !== 2) return;
    const mid = this.points[0].clone().add(this.points[1]).multiplyScalar(0.5);
    mid.project(this.viewer.camera);
    if (mid.z > 1) { this.label.style.display = 'none'; return; }
    this.label.style.display = '';
    const rect = this.viewer.renderer.domElement.getBoundingClientRect();
    const wrap = this.labelsEl.getBoundingClientRect();
    this.label.style.left =
      ((mid.x + 1) / 2) * rect.width + (rect.left - wrap.left) + 'px';
    this.label.style.top =
      ((-mid.y + 1) / 2) * rect.height + (rect.top - wrap.top) + 'px';
  }

  clear() {
    for (const m of this.markers) {
      this.viewer.overlayGroup.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    }
    this.markers = [];
    if (this.line) {
      this.viewer.overlayGroup.remove(this.line);
      this.line.geometry.dispose();
      this.line.material.dispose();
      this.line = null;
    }
    if (this.label) { this.label.remove(); this.label = null; }
    this.points = [];
  }
}
