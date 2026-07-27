// ============================================================
// Cinemática de Explosão Automática Inteligente (IA) — v2
// ------------------------------------------------------------
// Estilo "manual de montagem profissional": os componentes saem
// UM DE CADA VEZ, devagar, com separações generosas que deixam a
// montagem óbvia. O planejador continua garantindo caminho livre
// (varredura AABB + ondas + efeito telescópio), mas a linha do
// tempo é estritamente sequencial:
//   peça 1 → pausa → peça 2 → pausa → …
// A câmera acompanha: enquadra a cena crescente, gira devagar e
// se alinha suavemente para que o movimento de cada peça fique
// visível (movimento em X/Y é mostrado de lado, nunca "de frente").
// A peça ativa pulsa em laranja e o HUD mostra o nome e o passo.
// ============================================================
import * as THREE from 'three';
import { easeInOutCubic, clamp, lerp } from './utils.js';

const EPS = 0.5; // mm — tolerância p/ peças encostadas
const AXES = ['x', 'y', 'z'];

function shrunk(box, out) {
  out.copy(box);
  out.min.addScalar(EPS);
  out.max.subScalar(EPS);
  return out;
}

function overlapsLateral(a, b, axisIdx) {
  for (let k = 0; k < 3; k++) {
    if (k === axisIdx) continue;
    const ax = AXES[k];
    if (a.max[ax] - EPS <= b.min[ax] + EPS || a.min[ax] + EPS >= b.max[ax] - EPS) return false;
  }
  return true;
}

const wrapPi = (a) => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};

export class ExplodeTool {
  constructor(app) {
    this.app = app;
    this.viewer = app.viewer;
    this.model = app.model;
    this.hud = document.getElementById('explode-hud');
    this.planned = false;
    this.playing = false;
    this.factor = 0;
    this.duration = 0;
    this.speed = 1;
    this._entries = [];
    this._raf = null;
    this._activeEntry = null;
  }

  // ---------------- Planejamento ----------------
  plan() {
    const comps = this.model.visibleComponents();
    this._entries = [];
    if (comps.length < 2) return false;

    const union = this.model.unionBox(true);
    const center = union.getCenter(new THREE.Vector3());
    const diag = union.getSize(new THREE.Vector3()).length();
    // separação generosa: proporcional ao produto, nunca tímida
    const gap = clamp(diag * 0.28, 120, 800);

    // Unidades: cada montagem = UM bloco (explode inteira, junta);
    // peças soltas = unidades individuais.
    const unitByAsm = new Map();
    const units = [];
    for (const comp of comps) {
      if (comp.assembly) {
        let u = unitByAsm.get(comp.assembly);
        if (!u) {
          u = { name: '📦 ' + comp.assembly.name, comps: [] };
          unitByAsm.set(comp.assembly, u);
          units.push(u);
        }
        u.comps.push(comp);
      } else {
        units.push({ name: comp.name, comps: [comp] });
      }
    }
    if (units.length < 2) return false;

    const items = units.map((u) => {
      const box = new THREE.Box3();
      const tmp = new THREE.Box3();
      for (const c of u.comps) box.union(c.currentAABB(tmp));
      // eixo "fino": peça única usa a OBB; montagem usa a própria caixa
      let thin;
      if (u.comps.length === 1) {
        thin = u.comps[0].dims.axes[2];
      } else {
        const size = box.getSize(new THREE.Vector3());
        const arr = [size.x, size.y, size.z];
        const idx = arr.indexOf(Math.min(...arr));
        thin = new THREE.Vector3();
        thin[AXES[idx]] = 1;
      }
      return { unit: u, thin, box, dir: null, travel: 0, wave: -1 };
    });

    const candidatesFor = (item) => {
      const boxCenter = item.box.getCenter(new THREE.Vector3());
      const offset = boxCenter.clone().sub(center);
      const cands = [];
      const push = (axisIdx, sign) => {
        if (!cands.some((c) => c.axisIdx === axisIdx && c.sign === sign)) {
          cands.push({ axisIdx, sign });
        }
      };
      // 1) eixo da espessura (normal do painel), snapado ao eixo do mundo
      const thin = item.thin;
      const t = [Math.abs(thin.x), Math.abs(thin.y), Math.abs(thin.z)];
      const thinIdx = t.indexOf(Math.max(...t));
      if (t[thinIdx] > 0.8) {
        const off = offset[AXES[thinIdx]];
        const s = Math.abs(off) > 1e-3 ? Math.sign(off) : 1;
        push(thinIdx, s);
        push(thinIdx, -s);
      }
      // 2) eixos radiais por magnitude do afastamento do centro
      const order = [0, 1, 2].sort(
        (a, b) => Math.abs(offset[AXES[b]]) - Math.abs(offset[AXES[a]]));
      for (const idx of order) {
        const off = offset[AXES[idx]];
        push(idx, Math.abs(off) > 1e-3 ? Math.sign(off) : 1);
      }
      push(2, 1); // fallback: para cima
      return cands;
    };

    const travelToClear = (box, axisIdx, sign, bounds) => {
      const ax = AXES[axisIdx];
      return sign > 0
        ? (bounds.max[ax] - box.min[ax]) + gap
        : (box.max[ax] - bounds.min[ax]) + gap;
    };

    const sweptBox = (box, axisIdx, sign, travel, out) => {
      shrunk(box, out);
      const ax = AXES[axisIdx];
      if (sign > 0) out.max[ax] += travel; else out.min[ax] -= travel;
      return out;
    };

    const tmpBox = new THREE.Box3();
    const countBlockers = (item, cand, remaining) => {
      const travel = travelToClear(item.box, cand.axisIdx, cand.sign, union);
      sweptBox(item.box, cand.axisIdx, cand.sign, travel, tmpBox);
      let n = 0;
      for (const other of remaining) {
        if (other === item) continue;
        if (tmpBox.intersectsBox(shrunk(other.box, new THREE.Box3()))) n++;
      }
      return { blockers: n, travel };
    };

    // ondas gulosas (garantem caminho livre no momento da saída)
    let remaining = [...items];
    const placedFinals = [];
    let waveIdx = 0;
    let guard = 0;

    while (remaining.length && guard++ < items.length + 10) {
      for (const item of remaining) {
        item.evals = candidatesFor(item).map((cand) => ({
          cand, ...countBlockers(item, cand, remaining)
        }));
        item.evals.sort((a, b) => a.blockers - b.blockers);
        item.best = item.evals[0];
      }
      let wave = remaining.filter((it) => it.best.blockers === 0);
      if (!wave.length) {
        wave = [remaining.reduce((a, b) => (a.best.blockers <= b.best.blockers ? a : b))];
      }

      for (const item of wave) {
        let placedOk = false;
        for (const ev of item.evals) {
          const { cand } = ev;
          let travel = ev.travel;
          const ax = AXES[cand.axisIdx];
          let feasible = true;
          for (const pf of placedFinals) {
            if (!overlapsLateral(item.box, pf, cand.axisIdx)) continue;
            const room = cand.sign > 0
              ? pf.min[ax] - item.box.max[ax]
              : item.box.min[ax] - pf.max[ax];
            if (room <= 0) continue;
            const allowed = room - gap * 0.45;
            if (allowed < ev.travel * 0.3) { feasible = false; break; }
            travel = Math.min(travel, allowed);
          }
          if (!feasible) continue;
          item.dir = new THREE.Vector3();
          item.dir[ax] = cand.sign;
          item.axisIdx = cand.axisIdx;
          item.travel = travel;
          placedOk = true;
          break;
        }
        if (!placedOk) {
          const ev = item.evals[0];
          const ax = AXES[ev.cand.axisIdx];
          item.dir = new THREE.Vector3();
          item.dir[ax] = ev.cand.sign;
          item.axisIdx = ev.cand.axisIdx;
          item.travel = ev.travel * 0.35;
        }
        item.wave = waveIdx;
        placedFinals.push(item.box.clone().translate(
          item.dir.clone().multiplyScalar(item.travel)));
      }

      remaining = remaining.filter((it) => !wave.includes(it));
      waveIdx++;
    }

    // ------- Sequência didática: UMA peça por vez -------
    // Dentro de cada onda, agrupa por direção (movimentos parecidos em
    // sequência = narrativa clara) e vai do mais afastado ao mais próximo.
    items.sort((a, b) => {
      if (a.wave !== b.wave) return a.wave - b.wave;
      const dirKeyA = a.axisIdx * 2 + (a.dir[AXES[a.axisIdx]] > 0 ? 0 : 1);
      const dirKeyB = b.axisIdx * 2 + (b.dir[AXES[b.axisIdx]] > 0 ? 0 : 1);
      if (dirKeyA !== dirKeyB) return dirKeyA - dirKeyB;
      const da = a.box.getCenter(new THREE.Vector3()).distanceTo(center);
      const db = b.box.getCenter(new THREE.Vector3()).distanceTo(center);
      return db - da;
    });

    // ritmo: adapta à quantidade de peças (sempre 1 por vez)
    const n = items.length;
    const moveDur = n <= 12 ? 1.8 : n <= 24 ? 1.5 : n <= 40 ? 1.2 : 1.0;
    const pauseDur = n <= 12 ? 0.55 : n <= 24 ? 0.4 : 0.28;
    items.forEach((item, k) => {
      item.order = k;
      item.start = 0.6 + k * (moveDur + pauseDur); // 0.6s de "respiro" inicial
      item.dur = moveDur;
    });
    this.duration = 0.6 + n * (moveDur + pauseDur) + 0.6;
    this._entries = items;
    this.planned = true;
    return true;
  }

  // ---------------- Aplicação de offsets ----------------
  _applyTime(tSec) {
    this._activeEntry = null;
    for (const item of this._entries) {
      const u = clamp((tSec - item.start) / item.dur, 0, 1);
      if (u > 0 && u < 1) this._activeEntry = item;
      const eased = easeInOutCubic(u);
      for (const c of item.unit.comps) {
        c.explodeOffset.copy(item.dir).multiplyScalar(item.travel * eased);
        c.applyTransform();
      }
    }
    this.factor = this.duration > 0 ? clamp(tSec / this.duration, 0, 1) : 0;
    this._updatePartLabel(tSec);
  }

  setFactor(f) {
    if (!this.planned) return;
    this._applyTime(clamp(f, 0, 1) * this.duration);
    this._syncSlider();
  }

  // ---------------- Reprodução cinematográfica ----------------
  play() {
    if (this.playing) return;
    if (!this.model.hasModel) return;
    this.app.setMode('select');
    this.collapseInstant();
    if (!this.plan()) {
      this.app.ui.toast('São necessários ao menos 2 componentes visíveis para explodir.', 'warn');
      return;
    }
    this.playing = true;
    this.viewer.controls.enabled = false;
    this.showHud(true);
    this.app.setStatus(
      'Explosão IA — cada componente sai individualmente; ajuste a velocidade no controle abaixo');

    const ctrl = this.viewer.controls;
    const s0 = ctrl.getSpherical();
    this._smTarget = ctrl.target.clone();
    this._smDist = s0.dist;
    this._az = s0.az;
    this._smPolar = clamp(s0.polar, 0.6, 1.2);
    this._t = 0;
    this._lastNow = performance.now();
    this._pulsePhase = 0;
    let lastActive = null;

    const boxTmp = new THREE.Box3();
    const step = (now) => {
      if (!this.playing) return;
      const dt = Math.min((now - this._lastNow) / 1000, 0.1);
      this._lastNow = now;
      this._t += dt * this.speed;
      const t = this._t;
      this._applyTime(t);

      const active = this._activeEntry;

      // ---- destaque pulsante da unidade ativa ----
      if (lastActive && lastActive !== active) {
        for (const c of lastActive.unit.comps) this.viewer._applyEmissive(c);
      }
      if (active) {
        this._pulsePhase += dt * 7;
        const p = 0.55 + 0.45 * Math.sin(this._pulsePhase);
        for (const c of active.unit.comps) {
          c.mesh.material.emissive.setRGB(0.42 * p, 0.20 * p, 0.03 * p);
        }
      }
      lastActive = active;

      // ---- direção da câmera (takes): cena inteira como referência ----
      boxTmp.makeEmpty();
      const tmp = new THREE.Box3();
      for (const item of this._entries) {
        for (const c of item.unit.comps) {
          if (!c.group.visible) continue;
          boxTmp.union(c.currentAABB(tmp));
        }
      }
      const fitScene = boxTmp.isEmpty()
        ? this._smDist : this.viewer.fitDistanceFor(boxTmp) * 1.03;

      let focus, wantDist, polarGoal;
      if (active) {
        // TAKE FECHADO: enquadra a peça + o encaixe de onde ela sai + o
        // destino — perto o bastante para mostrar o detalhe da montagem
        const localBox = active.box.clone() // encaixe original ("buraco")
          .union(active.box.clone().translate(
            active.dir.clone().multiplyScalar(active.travel)));
        const tmpU = new THREE.Box3();
        for (const c of active.unit.comps) localBox.union(c.currentAABB(tmpU));
        localBox.expandByScalar(active.travel * 0.10 + 50);
        focus = localBox.getCenter(new THREE.Vector3());
        // olhar puxado ao encaixe: é ali que a montagem "acontece"
        focus.lerp(active.box.getCenter(new THREE.Vector3()), 0.30);
        wantDist = clamp(this.viewer.fitDistanceFor(localBox) * 1.12,
          fitScene * 0.42, fitScene * 1.02);
        // elevação por direção: movimentos verticais pedem vista mais alta
        polarGoal = active.axisIdx === 2 ? 1.02 : 0.88;
      } else {
        // PAUSA: reabre o plano geral e ANTECIPA a próxima peça
        focus = boxTmp.isEmpty()
          ? this._smTarget.clone() : boxTmp.getCenter(new THREE.Vector3());
        wantDist = fitScene;
        polarGoal = 0.95;
        const next = this._entries.find(
          (it) => it.start >= t && it.start - t < 1.6);
        if (next) {
          const nb = new THREE.Box3();
          const tmpN = new THREE.Box3();
          for (const c of next.unit.comps) nb.union(c.currentAABB(tmpN));
          focus.lerp(nb.getCenter(new THREE.Vector3()), 0.5);
          wantDist = lerp(fitScene, clamp(
            this.viewer.fitDistanceFor(nb) * 2.4,
            fitScene * 0.42, fitScene), 0.5);
        }
      }
      const kT = 1 - Math.exp(-dt * 2.6);
      const kD = 1 - Math.exp(-dt * 2.0);
      this._smTarget.lerp(focus, kT);
      this._smDist = lerp(this._smDist, wantDist, kD);

      // ---- azimute: gira devagar e se alinha para VER o movimento ----
      if (active && active.axisIdx !== 2) {
        // movimento em X é visto de ±Y (az ±π/2); em Y, de ±X (az 0/π)
        const desired = active.axisIdx === 0
          ? [-Math.PI / 2, Math.PI / 2] : [0, Math.PI];
        let goal = desired[0];
        for (const d of desired) {
          if (Math.abs(wrapPi(d - this._az)) < Math.abs(wrapPi(goal - this._az))) goal = d;
        }
        // vista 3/4: desloca ~0,5 rad do eixo para dar profundidade ao take
        goal += 0.5 * Math.sign(wrapPi(this._az - goal) || 1);
        this._az += wrapPi(goal - this._az) * Math.min(1, dt * 1.5);
        this._az += 0.02 * dt; // vida
      } else {
        this._az += 0.13 * dt; // deriva suave entre peças / movimentos verticais
      }

      const kP = 1 - Math.exp(-dt * 1.4);
      this._smPolar = lerp(this._smPolar,
        clamp(polarGoal + 0.06 * Math.sin(t * 0.5), 0.5, 1.25), kP);
      ctrl.setSpherical(this._az, this._smPolar, this._smDist, this._smTarget);

      this._syncSlider();
      if (t >= this.duration) {
        if (lastActive) {
          for (const c of lastActive.unit.comps) this.viewer._applyEmissive(c);
        }
        this._finishPlay();
        return;
      }
      this._raf = requestAnimationFrame(step);
    };
    this._raf = requestAnimationFrame(step);
  }

  _finishPlay() {
    this.playing = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    this.viewer.controls.enabled = true;
    this._applyTime(this.duration);
    for (const item of this._entries) {
      for (const c of item.unit.comps) this.viewer._applyEmissive(c);
    }
    // plano geral final: reenquadra o produto explodido inteiro
    this.viewer.fitBox(this.model.unionBox(), true);
    this._syncSlider();
    this.showHud(true);
    this.app.setStatus(
      'Explosão concluída — arraste o slider para rever a montagem passo a passo');
  }

  skip() {
    if (!this.playing) return;
    this._finishPlay();
  }

  collapse(animated = true) {
    if (this.playing) this.skip();
    if (!this.planned) return;
    if (!animated) { this.collapseInstant(); return; }
    const from = this.factor;
    this.viewer.tweens.add({
      duration: 900,
      onUpdate: (t) => this.setFactor(from * (1 - t)),
      onComplete: () => this._syncSlider()
    });
  }

  collapseInstant() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this.playing = false;
    for (const c of this.model.components) {
      c.explodeOffset.set(0, 0, 0);
      c.applyTransform();
      this.viewer._applyEmissive(c);
    }
    this.factor = 0;
    this.viewer.controls.enabled = true;
  }

  close() {
    this.collapseInstant();
    this.planned = false;
    this.showHud(false);
    this.app.setStatusDefault();
  }

  // ---------------- HUD ----------------
  showHud(show) {
    if (!show) { this.hud.classList.add('hidden'); return; }
    if (!this.hud.dataset.built) {
      this.hud.dataset.built = '1';
      this.hud.innerHTML = '';

      const title = document.createElement('span');
      title.className = 'hud-title';
      title.textContent = '💥 Explosão IA';
      this.hud.appendChild(title);

      const partLabel = document.createElement('span');
      partLabel.className = 'hud-part';
      this.hud.appendChild(partLabel);
      this._partLabel = partLabel;

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '0'; slider.max = '1000'; slider.value = '0';
      slider.addEventListener('input', () => {
        // captura ANTES do skip (que sincroniza o slider para 100%)
        const v = parseInt(slider.value, 10) / 1000;
        if (this.playing) this.skip();
        this.setFactor(v);
      });
      this.hud.appendChild(slider);
      this._slider = slider;

      const speed = document.createElement('select');
      speed.title = 'Velocidade da animação';
      for (const [v, label] of [[0.5, '0,5×'], [1, '1×'], [1.5, '1,5×'], [2, '2×'], [3, '3×']]) {
        const o = document.createElement('option');
        o.value = String(v);
        o.textContent = label;
        if (v === 1) o.selected = true;
        speed.appendChild(o);
      }
      speed.addEventListener('change', () => {
        this.speed = parseFloat(speed.value);
      });
      this.hud.appendChild(speed);

      const mk = (label, fn, title2) => {
        const b = document.createElement('button');
        b.textContent = label;
        if (title2) b.title = title2;
        b.addEventListener('click', fn);
        this.hud.appendChild(b);
        return b;
      };
      this._skipBtn = mk('Pular ⏭', () => this.skip(), 'Pular a animação');
      mk('↻ Replay', () => { this.close(); this.play(); });
      mk('Recolher', () => this.collapse(true));
      mk('✕ Fechar', () => this.close());
    }
    this._skipBtn.style.display = this.playing ? '' : 'none';
    this.hud.classList.remove('hidden');
  }

  _updatePartLabel(tSec) {
    if (!this._partLabel) return;
    const n = this._entries.length;
    const active = this._activeEntry;
    if (active) {
      this._partLabel.textContent = `▶ ${active.order + 1}/${n} — ${active.unit.name}`;
    } else if (this.factor >= 1) {
      this._partLabel.textContent = `✓ ${n} componentes explodidos`;
    } else if (tSec > 0.01) {
      // entre peças: mostra a próxima
      const next = this._entries.find((it) => it.start >= tSec);
      this._partLabel.textContent = next
        ? `${next.order + 1}/${n} — ${next.unit.name}` : '';
    } else {
      this._partLabel.textContent = '';
    }
  }

  _syncSlider() {
    if (this._slider) this._slider.value = String(Math.round(this.factor * 1000));
    if (this._skipBtn) this._skipBtn.style.display = this.playing ? '' : 'none';
  }
}
