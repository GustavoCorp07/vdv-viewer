// Manual de Montagem interativo (estilo IKEA profissional):
// inverte a sequência inteligente da explosão — cada passo instala UMA
// peça (que chega animada da posição explodida) seguida das suas
// ferragens, com a lista de fixação do passo, navegação ◀ ▶, auto-play
// e câmera que enquadra a região da montagem.
import * as THREE from 'three';
import { easeInOutCubic, clamp } from './utils.js';

const PANEL_MS = 1100;
const HW_MS = 500;
const ITEM_GAP_MS = 140;

export class ManualTool {
  constructor(app) {
    this.app = app;
    this.viewer = app.viewer;
    this.active = false;
    this.auto = false;
    this.steps = [];
    this.step = -1;
    this._anim = null;
    this._autoTimer = null;
    this.hud = document.getElementById('manual-hud');
    this.viewer.onFrame((now) => this._tick(now));
  }

  open() {
    if (!this.app.model.hasModel) return;
    this.app.setMode('select');
    this.app.select(null);
    this.app.explode.close();
    if (!this.app.explode.plan()) {
      this.app.ui.toast('São necessários ao menos 2 componentes para o manual.', 'warn');
      return;
    }
    const md = this.app.explode.manualData;
    if (!md || !md.panels.length) {
      this.app.ui.toast('Não foi possível montar a sequência.', 'warn');
      return;
    }

    // montagem = ordem INVERSA da desmontagem
    this.steps = [];
    const panels = [...md.panels].reverse();
    for (const p of panels) {
      this.steps.push({ unit: p, fixings: md.fixings(p) });
    }
    if (md.loose.length) {
      this.steps.push({ unit: null, fixings: md.loose, loose: true });
    }

    this.active = true;
    this.auto = false;
    this.app.model.manualHiddenSet = new Set(this.app.model.components);
    this.app.model.applyVisibilityAll();
    this._buildHud();
    this.step = -1;
    this.next();
    this.app.setStatus(
      'Manual de Montagem — ◀ ▶ navegam os passos • espaço = auto-play • Esc sai');
  }

  close() {
    if (!this.active) return;
    this.active = false;
    this.auto = false;
    if (this._autoTimer) { clearTimeout(this._autoTimer); this._autoTimer = null; }
    this._anim = null;
    this.app.model.manualHiddenSet = null;
    for (const c of this.app.model.components) {
      c.explodeOffset.set(0, 0, 0);
      c.applyTransform();
      this.viewer._applyEmissive(c);
    }
    this.app.explode.planned = false;
    this.app.model.applyVisibilityAll();
    this.hud.classList.add('hidden');
    this.app.fitAll();
    this.app.setStatusDefault();
  }

  // ---------------- Navegação ----------------
  next() {
    if (this._anim) { this._finishAnim(); return; } // 2º clique pula a animação
    if (this.step < this.steps.length - 1) this._goto(this.step + 1, true);
    else if (this.auto) this._setAuto(false);
  }

  prev() {
    this._finishAnim();
    if (this.step > 0) this._goto(this.step - 1, false);
  }

  restart() {
    this._finishAnim();
    this._goto(0, true);
  }

  _stepItems(st) {
    return [...(st.unit ? [st.unit] : []), ...st.fixings];
  }

  _goto(i, animate) {
    this.step = clamp(i, 0, this.steps.length - 1);

    // visibilidade: tudo até o passo atual
    const show = new Set();
    for (let k = 0; k <= this.step; k++) {
      for (const it of this._stepItems(this.steps[k])) {
        for (const c of it.unit.comps) show.add(c);
      }
    }
    const hidden = this.app.model.manualHiddenSet;
    hidden.clear();
    for (const c of this.app.model.components) {
      if (!show.has(c)) hidden.add(c);
    }
    this.app.model.applyVisibilityAll();

    // passos anteriores assentados; o atual anima (ou assenta direto)
    for (let k = 0; k < this.step; k++) {
      for (const it of this._stepItems(this.steps[k])) this._setItem(it, 0);
    }
    const st = this.steps[this.step];
    if (animate) {
      for (const it of this._stepItems(st)) this._setItem(it, 1); // parte da posição explodida
      this._anim = { st, t0: performance.now() };
    } else {
      for (const it of this._stepItems(st)) this._setItem(it, 0);
      this._anim = null;
    }

    // câmera: enquadra o que já está montado + a peça chegando
    const box = new THREE.Box3();
    for (const c of show) {
      box.union(c.aabb.clone().translate(c.userOffset));
    }
    if (!box.isEmpty()) {
      box.expandByScalar(box.getSize(new THREE.Vector3()).length() * 0.06 + 30);
      this.viewer.fitBox(box, true);
    }
    this._updateHud();
  }

  /** f = 1 → posição explodida; f = 0 → montada. */
  _setItem(item, f) {
    const off = this.app.explode._offsetAt(item, 1);
    for (const c of item.unit.comps) {
      c.explodeOffset.copy(off).multiplyScalar(f);
      c.applyTransform();
    }
  }

  _finishAnim() {
    if (!this._anim) return;
    for (const it of this._stepItems(this._anim.st)) {
      this._setItem(it, 0);
      for (const c of it.unit.comps) this.viewer._applyEmissive(c);
    }
    this._anim = null;
  }

  _tick(now) {
    if (!this.active || !this._anim) return;
    const st = this._anim.st;
    const items = this._stepItems(st);
    let t = now - this._anim.t0;
    let running = false;
    for (const it of items) {
      const d = it.unit.hardware ? HW_MS : PANEL_MS;
      let u;
      if (t <= 0) { u = 0; running = true; }
      else if (t >= d) { u = 1; }
      else { u = t / d; running = true; }
      this._setItem(it, 1 - easeInOutCubic(u));
      // pulso laranja no item em movimento
      if (u > 0 && u < 1) {
        const p = 0.55 + 0.45 * Math.sin(now / 90);
        for (const c of it.unit.comps) {
          c.mesh.material.emissive.setRGB(0.42 * p, 0.20 * p, 0.03 * p);
        }
      } else {
        for (const c of it.unit.comps) this.viewer._applyEmissive(c);
      }
      t -= d + ITEM_GAP_MS;
    }
    if (!running) {
      this._anim = null;
      if (this.auto) {
        this._autoTimer = setTimeout(() => {
          this._autoTimer = null;
          if (this.active && this.auto) this.next();
        }, 900);
      }
    }
  }

  _setAuto(on) {
    this.auto = on;
    this._autoBtn.textContent = on ? '⏸ Pausar' : '▶ Auto';
    this._autoBtn.classList.toggle('on', on);
    if (on && !this._anim) this.next();
    if (!on && this._autoTimer) {
      clearTimeout(this._autoTimer);
      this._autoTimer = null;
    }
  }

  // ---------------- HUD ----------------
  _buildHud() {
    if (!this.hud.dataset.built) {
      this.hud.dataset.built = '1';
      this.hud.innerHTML = `
        <div class="mh-info">
          <div class="mh-count" data-role="count"></div>
          <div class="mh-name" data-role="name"></div>
          <div class="mh-fix" data-role="fix"></div>
          <div class="mh-bar"><div data-role="fill"></div></div>
        </div>
        <div class="mh-controls">
          <button data-act="restart" title="Recomeçar">⏮</button>
          <button data-act="prev" title="Passo anterior (←)">◀</button>
          <button data-act="auto" title="Reprodução automática (espaço)">▶ Auto</button>
          <button data-act="next" title="Próximo passo (→)">▶</button>
          <button data-act="close" title="Sair do manual (Esc)">✕</button>
        </div>`;
      this.hud.querySelector('[data-act="restart"]')
        .addEventListener('click', () => this.restart());
      this.hud.querySelector('[data-act="prev"]')
        .addEventListener('click', () => this.prev());
      this.hud.querySelector('[data-act="next"]')
        .addEventListener('click', () => this.next());
      this.hud.querySelector('[data-act="close"]')
        .addEventListener('click', () => this.close());
      this._autoBtn = this.hud.querySelector('[data-act="auto"]');
      this._autoBtn.addEventListener('click', () => this._setAuto(!this.auto));
    }
    this._autoBtn = this.hud.querySelector('[data-act="auto"]');
    this.hud.classList.remove('hidden');
  }

  _updateHud() {
    const st = this.steps[this.step];
    this.hud.querySelector('[data-role="count"]').textContent =
      `Passo ${this.step + 1} de ${this.steps.length}`;
    this.hud.querySelector('[data-role="name"]').textContent = st.unit
      ? st.unit.unit.name.replace(/^📦 /, '📦 ')
      : '🔩 Ferragens avulsas';

    // agrupa fixações: "4× D3 L25"
    const fixEl = this.hud.querySelector('[data-role="fix"]');
    if (st.fixings.length) {
      const byName = new Map();
      for (const f of st.fixings) {
        const base = (f.unit.comps[0].baseName || f.unit.comps[0].name);
        byName.set(base, (byName.get(base) || 0) + 1);
      }
      fixEl.textContent = 'Fixação: ' + [...byName.entries()]
        .map(([n, q]) => `${q}× 🔩 ${n}`).join('  •  ');
      fixEl.style.display = '';
    } else {
      fixEl.style.display = 'none';
    }
    this.hud.querySelector('[data-role="fill"]').style.width =
      (((this.step + 1) / this.steps.length) * 100).toFixed(1) + '%';
  }
}
