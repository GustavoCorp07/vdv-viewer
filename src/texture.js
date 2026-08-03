// Ferramenta Textura: biblioteca de MDFs nacionais (1.287 padrões) com
// busca por nome/fabricante; aplica por clique ou substituindo por cor.
// UVs são geradas por projeção na OBB da peça (veio ao longo do comprimento).
import * as THREE from 'three';

const UV_SCALE = 620; // mm por repetição da textura (largura típica de decor)

export class TextureTool {
  constructor(app) {
    this.app = app;
    this.viewer = app.viewer;
    this.manifest = null;
    this.selected = null;
    this.loader = new THREE.TextureLoader();
    this.cache = new Map();
    this.panel = document.getElementById('texture-panel');
  }

  async toggle() {
    if (this.app.mode === 'texture') {
      this.app.setMode('select');
      return;
    }
    await this._ensureManifest();
    this.app.setMode('texture');
  }

  enable() {
    this._buildPanel();
    this.panel.classList.remove('hidden');
  }

  disable() {
    this.panel.classList.add('hidden');
  }

  async _ensureManifest() {
    if (this.manifest) return;
    try {
      const resp = await fetch('./texturas/manifest.json');
      this.manifest = await resp.json();
    } catch (_) {
      this.manifest = [];
      this.app.ui.toast('Biblioteca de texturas indisponível.', 'error');
    }
  }

  // ---------------- Painel ----------------
  _buildPanel() {
    if (this.panel.dataset.built) { this._renderGrid(); return; }
    this.panel.dataset.built = '1';
    this.panel.innerHTML = `
      <div class="fp-header"><span>🪵 Texturas MDF</span>
        <button class="fp-close" data-act="close">✕</button></div>
      <div class="tex-search">
        <input type="text" data-role="q" placeholder="Buscar textura… (ex.: Freijó, Cinza, Duratex)" />
        <select data-role="brand"><option value="">Todos os fabricantes</option></select>
      </div>
      <div class="tex-grid" data-role="grid"></div>
      <div class="tex-actions">
        <button class="btn-small" data-act="bycolor">🎯 Substituir por cor…</button>
        <button class="btn-small" data-act="removeall">🧹 Remover todas</button>
      </div>
      <div class="tex-foot" data-role="foot">Escolha uma textura e clique nas peças.</div>`;

    this._q = this.panel.querySelector('[data-role="q"]');
    this._brand = this.panel.querySelector('[data-role="brand"]');
    this._grid = this.panel.querySelector('[data-role="grid"]');
    this._foot = this.panel.querySelector('[data-role="foot"]');

    const brands = [...new Set(this.manifest.map((e) => e.brand))].sort();
    for (const b of brands) {
      const o = document.createElement('option');
      o.value = b; o.textContent = b;
      this._brand.appendChild(o);
    }
    this._q.addEventListener('input', () => this._renderGrid());
    this._brand.addEventListener('change', () => this._renderGrid());
    this.panel.querySelector('[data-act="close"]')
      .addEventListener('click', () => this.app.setMode('select'));
    this.panel.querySelector('[data-act="removeall"]')
      .addEventListener('click', () => this.removeAll());
    this.panel.querySelector('[data-act="bycolor"]')
      .addEventListener('click', () => this._replaceByColor());
    this._renderGrid();
  }

  _renderGrid() {
    const q = (this._q.value || '').toLowerCase().trim();
    const brand = this._brand.value;
    const list = this.manifest.filter((e) =>
      (!brand || e.brand === brand) &&
      (!q || e.name.toLowerCase().includes(q) || e.brand.toLowerCase().includes(q)));
    this._grid.innerHTML = '';
    const MAX = 96;
    for (const e of list.slice(0, MAX)) {
      const cell = document.createElement('button');
      cell.className = 'tex-cell' + (this.selected === e ? ' on' : '');
      cell.title = `${e.name} — ${e.brand}`;
      cell.innerHTML =
        `<img loading="lazy" src="./${e.file}" alt="" /><span>${e.name}</span>`;
      cell.addEventListener('click', () => {
        this.selected = e;
        this._renderGrid();
        this._foot.textContent =
          `✔ ${e.name} (${e.brand}) — clique nas peças do modelo para aplicar`;
        this.app.setStatus(
          `Textura "${e.name}" selecionada — clique nas peças • botão direito remove`);
      });
      this._grid.appendChild(cell);
    }
    const label = list.length > MAX
      ? `Mostrando ${MAX} de ${list.length} — refine a busca`
      : `${list.length} textura(s)`;
    const info = document.createElement('div');
    info.className = 'tex-count';
    info.textContent = label;
    this._grid.appendChild(info);
  }

  // ---------------- Aplicação ----------------
  /**
   * UVs POR FACE (box mapping): cada triângulo escolhe o plano de projeção
   * pela própria normal — as bordas (espessura) ganham o plano delas em
   * vez de herdarem o da face principal (que as deixava "esticadas").
   * O veio (U) segue sempre o COMPRIMENTO da peça; comp.textureRot (0/90)
   * gira a direção do veio para texturas amadeiradas.
   */
  _generateUV(comp) {
    const geo = comp.mesh.geometry;
    const pos = geo.attributes.position;
    const idx = geo.index;
    const [aC, aL, aE] = comp.dims.axes; // comprimento, largura, espessura
    const arr = new Float32Array(pos.count * 2);
    const rot = ((comp.textureRot || 0) % 180) === 90;

    const pA = new THREE.Vector3(), pB = new THREE.Vector3(), pC = new THREE.Vector3();
    const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();
    const p = new THREE.Vector3();
    const triCount = idx ? idx.count / 3 : pos.count / 3;

    for (let t = 0; t < triCount; t++) {
      const i0 = idx ? idx.getX(t * 3) : t * 3;
      const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      pA.fromBufferAttribute(pos, i0);
      pB.fromBufferAttribute(pos, i1);
      pC.fromBufferAttribute(pos, i2);
      ab.copy(pB).sub(pA);
      ac.copy(pC).sub(pA);
      n.copy(ab).cross(ac).normalize();

      const dC = Math.abs(n.dot(aC));
      const dL = Math.abs(n.dot(aL));
      const dE = Math.abs(n.dot(aE));
      let U, V;
      if (dE >= dC && dE >= dL) { U = aC; V = aL; }      // face principal
      else if (dL >= dC) { U = aC; V = aE; }             // borda longitudinal
      else { U = aL; V = aE; }                            // topo (fim do veio)

      for (const vi of [i0, i1, i2]) {
        p.fromBufferAttribute(pos, vi);
        let uu = p.dot(U) / UV_SCALE;
        let vv = p.dot(V) / UV_SCALE;
        if (rot) { const tmp = uu; uu = vv; vv = -tmp; } // veio girado 90°
        arr[vi * 2] = uu;
        arr[vi * 2 + 1] = vv;
      }
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(arr, 2));
    geo.attributes.uv.needsUpdate = true;
  }

  /** Gira a direção do veio da textura da peça em 90°. */
  rotate(comp) {
    if (!comp.textureId) {
      this.app.ui.toast('Aplique uma textura à peça antes de girar o veio.', 'warn');
      return;
    }
    comp.textureRot = (((comp.textureRot || 0) + 90) % 180);
    this._generateUV(comp);
    this.app.ui.toast(
      `Veio da textura de "${comp.name}": ${comp.textureRot === 90 ? 'girado 90°' : 'direção original'}.`,
      'success');
  }

  async _load(entry) {
    if (this.cache.has(entry.id)) return this.cache.get(entry.id);
    const tex = await this.loader.loadAsync('./' + entry.file);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(
      8, this.viewer.renderer.capabilities.getMaxAnisotropy());
    this.cache.set(entry.id, tex);
    return tex;
  }

  async apply(comp, entry = this.selected) {
    if (!entry) {
      this.app.ui.toast('Escolha uma textura no painel primeiro.', 'warn');
      return;
    }
    try {
      const tex = await this._load(entry);
      this._generateUV(comp);
      const mat = comp.mesh.material;
      mat.map = tex;
      mat.color.set(0xffffff);
      mat.needsUpdate = true;
      comp.textureId = entry.id;
    } catch (_) {
      this.app.ui.toast('Falha ao carregar a textura.', 'error');
    }
  }

  remove(comp) {
    const mat = comp.mesh.material;
    if (!mat.map && !comp.textureId) return;
    mat.map = null;
    mat.color.copy(comp.baseColor);
    mat.needsUpdate = true;
    comp.textureId = null;
  }

  removeAll() {
    for (const c of this.app.model.components) this.remove(c);
    this.app.ui.toast('Texturas removidas de todas as peças.');
  }

  /** Aplica a textura selecionada a todas as peças de uma cor escolhida. */
  _replaceByColor() {
    if (!this.selected) {
      this.app.ui.toast('Escolha uma textura no painel primeiro.', 'warn');
      return;
    }
    const groups = new Map();
    for (const c of this.app.model.components) {
      const hex = c.baseColor.getHexString();
      if (!groups.has(hex)) groups.set(hex, []);
      groups.get(hex).push(c);
    }
    const content = document.createElement('div');
    const p = document.createElement('p');
    p.style.cssText = 'margin-bottom:10px;font-size:12px;color:#5a6572';
    p.textContent =
      `Aplicar "${this.selected.name}" a todas as peças da cor escolhida:`;
    content.appendChild(p);
    const wrap = document.createElement('div');
    wrap.className = 'color-pick-list';
    let close;
    for (const [hex, comps] of groups) {
      const b = document.createElement('button');
      b.className = 'color-pick';
      b.innerHTML =
        `<span class="prop-swatch" style="background:#${hex}"></span>` +
        ` #${hex.toUpperCase()} — ${comps.length} peça(s)`;
      b.addEventListener('click', async () => {
        for (const c of comps) await this.apply(c);
        this.app.ui.toast(
          `Textura aplicada a ${comps.length} peça(s) da cor #${hex.toUpperCase()}.`,
          'success');
        if (close) close();
      });
      wrap.appendChild(b);
    }
    content.appendChild(wrap);
    close = this.app.ui.showModal({
      title: '🎯 Substituir por cor',
      content,
      actions: [{ label: 'Fechar' }]
    });
  }

  // ---------------- Persistência na nuvem ----------------
  captureState() {
    return this.app.model.components.map((c) => c.textureId || null);
  }

  async applyState(arr) {
    if (!Array.isArray(arr)) return;
    await this._ensureManifest();
    const byId = new Map(this.manifest.map((e) => [e.id, e]));
    const comps = this.app.model.components;
    for (let i = 0; i < arr.length && i < comps.length; i++) {
      if (!arr[i]) continue;
      const entry = byId.get(arr[i]);
      if (entry) await this.apply(comps[i], entry);
    }
  }
}
