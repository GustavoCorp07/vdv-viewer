// ============================================================
// Cinemática de Explosão Automática Inteligente (IA) — v3
// ------------------------------------------------------------
// Sequencial (uma unidade por vez) com três avanços de engenharia:
//
// 1. FERRAGENS PRIMEIRO: parafusos/cavilhas/minifix são detectados
//    automaticamente (nome + proporções: seção pequena e alongada) e
//    saem ANTES das peças, deslizando ao longo do próprio eixo para
//    fora da peça-hospedeira, sem colisão.
//
// 2. COLISÃO AVANÇADA: cada unidade avalia as 6 direções do mundo,
//    com varredura AABB contra as peças restantes E contra os destinos
//    já ocupados; quando a "vaga" final está tomada, a peça faz um
//    desvio em L (dogleg): sai do móvel e estaciona ao lado, em vaga
//    comprovadamente livre. Nada atravessa nada.
//
// 3. MONTAGENS como blocos únicos (inalterado).
// ============================================================
import * as THREE from 'three';
import { easeInOutCubic, clamp, lerp } from './utils.js';

const EPS = 0.5;
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

/** Ferragem: nome sugestivo OU seção transversal pequena e corpo alongado. */
function isHardwareComp(comp) {
  const name = ((comp.baseName || comp.name) || '').toLowerCase();
  if (/paraf|screw|cavilha|minifix|bucha|pino\b|dowel|bolt|porca|\bnut\b|dobradi|corredi|puxador|ferrag/.test(name)) {
    return true;
  }
  const { c, l, e } = comp.dims;
  const cross = Math.max(l, e);
  return cross <= 24 && c <= 240 && c >= cross * 2.2;
}

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

  // ================= Planejamento =================
  plan() {
    const comps = this.model.visibleComponents();
    this._entries = [];
    if (comps.length < 2) return false;

    const union = this.model.unionBox(true);
    const center = union.getCenter(new THREE.Vector3());
    const diag = union.getSize(new THREE.Vector3()).length();
    const gap = clamp(diag * 0.28, 120, 800);

    // ---- Unidades: montagens = bloco; ferragens = unidade marcada ----
    const unitByAsm = new Map();
    const units = [];
    for (const comp of comps) {
      if (comp.assembly) {
        let u = unitByAsm.get(comp.assembly);
        if (!u) {
          u = { name: '📦 ' + comp.assembly.name, comps: [], hardware: false };
          unitByAsm.set(comp.assembly, u);
          units.push(u);
        }
        u.comps.push(comp);
      } else {
        const hw = isHardwareComp(comp);
        units.push({
          name: (hw ? '🔩 ' : '') + comp.name,
          comps: [comp],
          hardware: hw
        });
      }
    }
    if (units.length < 2) return false;

    const items = units.map((u) => {
      const box = new THREE.Box3();
      const tmp = new THREE.Box3();
      for (const c of u.comps) box.union(c.currentAABB(tmp));
      let thin, longAxis;
      if (u.comps.length === 1) {
        thin = u.comps[0].dims.axes[2];
        longAxis = u.comps[0].dims.axes[0];
      } else {
        const size = box.getSize(new THREE.Vector3());
        const arr = [size.x, size.y, size.z];
        thin = new THREE.Vector3();
        thin[AXES[arr.indexOf(Math.min(...arr))]] = 1;
        longAxis = new THREE.Vector3();
        longAxis[AXES[arr.indexOf(Math.max(...arr))]] = 1;
      }
      return {
        unit: u, thin, longAxis, box,
        dir: null, travel: 0,
        dir2: null, travel2: 0,
        wave: -1
      };
    });

    // Ferragens são planejadas SEPARADO: cada uma sai imediatamente antes
    // da peça em que está presa (não no início, quando o móvel está cheio).
    const panelItems = items.filter((it) => !it.unit.hardware);
    const hwItems = items.filter((it) => it.unit.hardware);

    // Painéis JÁ INTERPENETRADOS no projeto original (interferências de
    // fábrica): separar-se deles é o próprio objetivo da explosão —
    // não contam como bloqueio de caminho.
    const tmpA = new THREE.Box3(), tmpB = new THREE.Box3();
    for (const item of panelItems) {
      item.hosts = new Set();
      const probe = shrunk(item.box, tmpA).clone();
      for (const other of panelItems) {
        if (other === item) continue;
        if (probe.intersectsBox(shrunk(other.box, tmpB))) item.hosts.add(other);
      }
    }

    // ---- Candidatos de direção ----
    const candidatesFor = (item) => {
      const boxCenter = item.box.getCenter(new THREE.Vector3());
      const offset = boxCenter.clone().sub(center);
      const cands = [];
      const push = (axisIdx, sign) => {
        if (!cands.some((c) => c.axisIdx === axisIdx && c.sign === sign)) {
          cands.push({ axisIdx, sign });
        }
      };
      const thin = item.thin;
      const t = [Math.abs(thin.x), Math.abs(thin.y), Math.abs(thin.z)];
      const thinIdx = t.indexOf(Math.max(...t));
      if (t[thinIdx] > 0.8) {
        const s = Math.sign(offset[AXES[thinIdx]]) || 1;
        push(thinIdx, s);
        push(thinIdx, -s);
      }
      // todas as 6 direções do mundo, priorizando o maior afastamento
      const order = [0, 1, 2].sort(
        (a, b) => Math.abs(offset[AXES[b]]) - Math.abs(offset[AXES[a]]));
      for (const idx of order) {
        const s = Math.sign(offset[AXES[idx]]) || 1;
        push(idx, s);
        push(idx, -s);
      }
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
    const tmpBox2 = new THREE.Box3();
    const countBlockers = (item, cand, remaining) => {
      const travel = travelToClear(item.box, cand.axisIdx, cand.sign, union);
      sweptBox(item.box, cand.axisIdx, cand.sign, travel, tmpBox);
      let n = 0;
      for (const other of remaining) {
        if (other === item) continue;
        if (item.hosts && item.hosts.has(other)) continue; // desliza pelo hospedeiro
        if (tmpBox.intersectsBox(shrunk(other.box, tmpBox2))) n++;
      }
      return { blockers: n, travel };
    };

    // ---- Estacionamento (dogleg): vaga final livre garantida ----
    const placedFinals = [];
    const finalConflicts = (finalBox) => placedFinals.filter((pf) => {
      const m = gap * 0.25;
      return finalBox.min.x < pf.max.x + m && finalBox.max.x > pf.min.x - m &&
             finalBox.min.y < pf.max.y + m && finalBox.max.y > pf.min.y - m &&
             finalBox.min.z < pf.max.z + m && finalBox.max.z > pf.min.z - m;
    });

    /** Caminho reto de `box` transladando `travel` ao longo de d1 cruza
     *  alguma vaga já ocupada? (varredura = união início∪fim, encolhida) */
    const pathHitsFinals = (box, axisIdx, sign, travel) => {
      const swept = new THREE.Box3();
      sweptBox(box, axisIdx, sign, travel, swept);
      return placedFinals.some((pf) => swept.intersectsBox(pf));
    };

    /**
     * Tenta assentar a peça com garantia TOTAL de caminho livre:
     *  A) pista livre até a vaga → direto;
     *  B) pista bloqueada por vaga ocupada → estaciona ANTES dela (se já
     *     estiver fora do móvel) — efeito telescópio correto;
     *  C) vaga tomada mas pista livre → dogleg: sai reto e desvia de lado
     *     até uma vaga comprovadamente livre (2º trecho também varrido).
     */
    const trySettle = (item, cand, travelClear) => {
      const ax = AXES[cand.axisIdx];
      const d1 = new THREE.Vector3();
      d1[ax] = cand.sign;
      const lead = cand.sign > 0 ? item.box.max[ax] : -item.box.min[ax];

      // vagas ocupadas na MESMA pista, à frente
      const lane = placedFinals
        .filter((pf) => overlapsLateral(item.box, pf, cand.axisIdx))
        .map((pf) => ({
          pf,
          room: (cand.sign > 0 ? pf.min[ax] : -pf.max[ax]) - lead
        }))
        .filter((l) => l.room > -EPS)
        .sort((a, b) => a.room - b.room);

      const outsideOk = (finalBox) => {
        // precisa ter saído do móvel (não intersectar a união original)
        const probe = finalBox.clone();
        probe.min.addScalar(EPS); probe.max.subScalar(EPS);
        return !probe.intersectsBox(union);
      };

      const commit = (travel, d2, travel2, finalBox) => {
        item.dir = d1; item.travel = travel;
        item.dir2 = d2; item.travel2 = travel2 || 0;
        placedFinals.push(finalBox);
        return true;
      };

      // A) pista totalmente livre até a distância de saída
      if (!lane.length || lane[0].room - gap * 0.35 >= travelClear) {
        const final1 = item.box.clone().translate(
          d1.clone().multiplyScalar(travelClear));
        if (!finalConflicts(final1).length &&
            !pathHitsFinals(item.box, cand.axisIdx, cand.sign, travelClear)) {
          return commit(travelClear, null, 0, final1);
        }
        // vaga tomada (conflito lateral) → C) dogleg
        if (!pathHitsFinals(item.box, cand.axisIdx, cand.sign, travelClear)) {
          const size = item.box.getSize(new THREE.Vector3());
          const perpAxes = [0, 1, 2].filter((i) => i !== cand.axisIdx);
          for (let ring = 1; ring <= 8; ring++) {
            for (const pi of perpAxes) {
              for (const ps of [1, -1]) {
                const pax = AXES[pi];
                const shift = ring * (size[pax] + gap * 0.7);
                const d2 = new THREE.Vector3();
                d2[pax] = ps;
                const final2 = final1.clone().translate(
                  d2.clone().multiplyScalar(shift));
                if (finalConflicts(final2).length) continue;
                const swept2 = final1.clone().union(final2);
                swept2.min.addScalar(EPS); swept2.max.subScalar(EPS);
                if (placedFinals.some((pf) => swept2.intersectsBox(pf))) continue;
                if (swept2.intersectsBox(union)) continue;
                return commit(travelClear, d2, shift, final2);
              }
            }
          }
        }
        return false;
      }

      // B) pista bloqueada antes da saída → estaciona antes do bloqueio,
      //    desde que a posição já esteja fora do móvel
      const shortTravel = lane[0].room - gap * 0.35;
      if (shortTravel > 0) {
        const finalS = item.box.clone().translate(
          d1.clone().multiplyScalar(shortTravel));
        if (outsideOk(finalS) && !finalConflicts(finalS).length &&
            !pathHitsFinals(item.box, cand.axisIdx, cand.sign, shortTravel)) {
          return commit(shortTravel, null, 0, finalS);
        }
      }
      return false;
    };

    /** Assenta usando SÓ candidatos sem bloqueio (allowBlocked=false) ou,
     *  em travamento real, os de menor bloqueio (allowBlocked=true). */
    const settlePlacement = (item, allowBlocked) => {
      for (const ev of item.evals) {
        if (!allowBlocked && ev.blockers > 0) break;
        if (allowBlocked && ev.blockers > item.best.blockers) break;
        if (trySettle(item, ev.cand, ev.travel)) return true;
      }
      return false;
    };

    /** Só para travamento absoluto: pista menos disputada, além de todas
     *  as vagas — pode cruzar geometria (avisado no console). */
    const forceCommit = (item) => {
      const ev = item.evals[0];
      const ax = AXES[ev.cand.axisIdx];
      const size = item.box.getSize(new THREE.Vector3());
      const d1 = new THREE.Vector3();
      d1[ax] = ev.cand.sign;
      let travel = ev.travel;
      for (const pf of placedFinals) {
        if (!overlapsLateral(item.box, pf, ev.cand.axisIdx)) continue;
        const beyond = ev.cand.sign > 0
          ? pf.max[ax] - item.box.min[ax]
          : item.box.max[ax] - pf.min[ax];
        travel = Math.max(travel, beyond + size[ax] + gap * 0.6);
      }
      item.dir = d1; item.travel = travel;
      item.dir2 = null; item.travel2 = 0;
      placedFinals.push(item.box.clone().translate(
        d1.clone().multiplyScalar(travel)));
      console.warn('[Explosão] assentamento forçado para', item.unit.name);
    };

    // ---- Ondas gulosas dos PAINÉIS: caminho livre garantido ----
    let remaining = [...panelItems];
    let waveIdx = 0;
    let guard = 0;
    while (remaining.length && guard++ < panelItems.length + 10) {
      for (const item of remaining) {
        item.evals = candidatesFor(item).map((cand) => ({
          cand, ...countBlockers(item, cand, remaining)
        }));
        item.evals.sort((a, b) => a.blockers - b.blockers);
        item.best = item.evals[0];
      }
      let forced = false;
      let wave = remaining.filter((it) => it.best.blockers === 0);
      if (!wave.length) {
        forced = true;
        wave = [remaining.reduce((a, b) => (a.best.blockers <= b.best.blockers ? a : b))];
      }
      const placed = [];
      for (const item of wave) {
        if (settlePlacement(item, forced)) {
          item.wave = waveIdx;
          placed.push(item);
        }
        // sem vaga segura nesta onda → adia (o cenário muda quando
        // mais peças saem; vagas e pistas se reorganizam)
      }
      if (!placed.length) {
        // nada assentou: garante progresso no menor mal
        const item = wave[0];
        forceCommit(item);
        item.wave = waveIdx;
        placed.push(item);
      }
      remaining = remaining.filter((it) => !placed.includes(it));
      waveIdx++;
    }

    // ---- Sequência didática dos painéis ----
    const dirKey = (it) => {
      if (!it.dir) return 0;
      const axis = it.dir.x !== 0 ? 0 : it.dir.y !== 0 ? 2 : 4;
      const sign = (it.dir.x + it.dir.y + it.dir.z) > 0 ? 0 : 1;
      return axis + sign;
    };
    panelItems.sort((a, b) => {
      if (a.wave !== b.wave) return a.wave - b.wave;
      if (dirKey(a) !== dirKey(b)) return dirKey(a) - dirKey(b);
      const da = a.box.getCenter(new THREE.Vector3()).distanceTo(center);
      const db = b.box.getCenter(new THREE.Vector3()).distanceTo(center);
      return db - da;
    });
    panelItems.forEach((p, i) => { p.seq = i; });

    // corredores que cada painel ainda vai varrer (trecho reto + dogleg)
    for (const p of panelItems) {
      p.corridors = [];
      if (!p.dir) continue;
      const ai = p.dir.x !== 0 ? 0 : p.dir.y !== 0 ? 1 : 2;
      const sg = p.dir[AXES[ai]] > 0 ? 1 : -1;
      const s1 = new THREE.Box3();
      sweptBox(p.box, ai, sg, p.travel, s1);
      p.corridors.push(s1.clone());
      if (p.dir2) {
        const f1 = p.box.clone().translate(p.dir.clone().multiplyScalar(p.travel));
        const f2 = f1.clone().translate(p.dir2.clone().multiplyScalar(p.travel2));
        const s2 = f1.union(f2);
        s2.min.addScalar(EPS); s2.max.subScalar(EPS);
        p.corridors.push(s2);
      }
    }

    // ---- Ferragens: saem A PARTIR da peça em que estão presas ----
    // âncora = hospedeiro que sai primeiro; a ferragem sai logo antes dele,
    // deslizando pelo próprio eixo só o bastante para liberar o conjunto,
    // com o caminho conferido contra as peças AINDA presentes naquele
    // momento e contra os corredores que os painéis vão varrer depois.
    const hwFinals = [];
    for (const hw of hwItems) {
      const probe = hw.box.clone().expandByScalar(2);
      hw.hostPanels = panelItems.filter((p) => probe.intersectsBox(p.box));
      hw.anchor = hw.hostPanels.length
        ? hw.hostPanels.reduce((a, b) => (a.seq <= b.seq ? a : b))
        : null;
      hw.hosts = new Set(hw.hostPanels);
      hw.wave = hw.anchor ? hw.anchor.wave : 0;

      const hostUnion = hw.box.clone();
      for (const p of hw.hostPanels) hostUnion.union(p.box);

      const la = hw.longAxis;
      const t = [Math.abs(la.x), Math.abs(la.y), Math.abs(la.z)];
      const ai = t.indexOf(Math.max(...t));
      const ax = AXES[ai];
      const anchorSeq = hw.anchor ? hw.anchor.seq : 0;
      const present = panelItems.filter(
        (p) => p.seq >= anchorSeq && !hw.hosts.has(p));

      const evalSign = (s) => {
        const travel0 = (s > 0
          ? hostUnion.max[ax] - hw.box.min[ax]
          : hw.box.max[ax] - hostUnion.min[ax]) + gap * 0.45;
        const sw = new THREE.Box3();
        sweptBox(hw.box, ai, s, travel0, sw);
        let blockers = 0;
        for (const p of present) {
          if (sw.intersectsBox(shrunk(p.box, tmpA))) blockers++;
        }
        return { s, travel0, blockers };
      };
      const evA = evalSign(1), evB = evalSign(-1);
      const ev = evA.blockers !== evB.blockers
        ? (evA.blockers < evB.blockers ? evA : evB)
        : (evA.travel0 <= evB.travel0 ? evA : evB); // lado da cabeça (saída curta)

      const d1 = new THREE.Vector3();
      d1[ax] = ev.s;
      let travel = ev.travel0;
      // afasta até sair dos corredores futuros e das outras ferragens
      const sizes = hw.box.getSize(new THREE.Vector3());
      const step = Math.max(sizes[ax], 30) + gap * 0.25;
      for (let k = 0; k < 8; k++) {
        const fin = hw.box.clone().translate(d1.clone().multiplyScalar(travel));
        const inCorridor =
          present.some((p) => p.corridors.some((c) => c.intersectsBox(fin))) ||
          hwFinals.some((f) => f.intersectsBox(fin));
        if (!inCorridor) break;
        travel += step;
      }
      hw.dir = d1;
      hw.travel = travel;
      hw.dir2 = null;
      hw.travel2 = 0;
      hwFinals.push(hw.box.clone().translate(d1.clone().multiplyScalar(travel)));
    }

    // ---- Tece a sequência: ferragens imediatamente ANTES do seu painel ----
    const hwByAnchor = new Map();
    const looseHw = [];
    for (const hw of hwItems) {
      if (!hw.anchor) { looseHw.push(hw); continue; }
      if (!hwByAnchor.has(hw.anchor)) hwByAnchor.set(hw.anchor, []);
      hwByAnchor.get(hw.anchor).push(hw);
    }
    const posKey = (h) => {
      const c = h.box.getCenter(new THREE.Vector3());
      return c.x * 7 + c.y * 3 + c.z;
    };
    const seq = [...looseHw.sort((a, b) => posKey(a) - posKey(b))];
    for (const p of panelItems) {
      const list = (hwByAnchor.get(p) || [])
        .sort((a, b) => dirKey(a) - dirKey(b) || posKey(a) - posKey(b));
      seq.push(...list, p);
    }

    // dados para o Manual de Montagem (ordem inversa = montagem)
    this.manualData = {
      panels: panelItems,
      fixings: (p) => hwByAnchor.get(p) || [],
      loose: looseHw
    };

    // ---- Ritmo: ferragens rápidas, peças pausadas ----
    const nPanels = panelItems.length;
    const moveDur = nPanels <= 12 ? 1.8 : nPanels <= 24 ? 1.5 : nPanels <= 40 ? 1.2 : 1.0;
    const pauseDur = nPanels <= 12 ? 0.55 : nPanels <= 24 ? 0.4 : 0.28;
    const hwDur = 0.85, hwPause = 0.18;
    let tCur = 0.6;
    seq.forEach((item, k) => {
      item.order = k;
      item.start = tCur;
      item.dur = item.unit.hardware ? hwDur : moveDur;
      tCur += item.dur + (item.unit.hardware ? hwPause : pauseDur);
    });
    this.duration = tCur + 0.6;
    this._entries = seq;
    this.planned = true;
    return true;
  }

  // ================= Aplicação de offsets =================
  _offsetAt(item, u) {
    const eased = easeInOutCubic(u);
    const off = item.dir.clone().multiplyScalar(item.travel *
      (item.dir2 ? easeInOutCubic(clamp(u / 0.62, 0, 1)) : eased));
    if (item.dir2) {
      const u2 = clamp((u - 0.62) / 0.38, 0, 1);
      off.addScaledVector(item.dir2, item.travel2 * easeInOutCubic(u2));
    }
    return off;
  }

  _applyTime(tSec) {
    this._activeEntry = null;
    for (const item of this._entries) {
      const u = clamp((tSec - item.start) / item.dur, 0, 1);
      if (u > 0 && u < 1) this._activeEntry = item;
      const off = this._offsetAt(item, u);
      for (const c of item.unit.comps) {
        c.explodeOffset.copy(off);
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

  // ================= Reprodução cinematográfica =================
  play() {
    if (this.playing) return;
    if (!this.model.hasModel) return;
    if (this.app.manual && this.app.manual.active) this.app.manual.close();
    if (this.app.unlockView) this.app.unlockView();
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
      'Explosão IA — ferragens saem primeiro; ajuste a velocidade no controle abaixo');

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
        const finalOff = this._offsetAt(active, 1);
        const localBox = active.box.clone()
          .union(active.box.clone().translate(finalOff));
        const tmpU = new THREE.Box3();
        for (const c of active.unit.comps) localBox.union(c.currentAABB(tmpU));
        localBox.expandByScalar(active.travel * 0.10 + 50);
        focus = localBox.getCenter(new THREE.Vector3());
        focus.lerp(active.box.getCenter(new THREE.Vector3()), 0.30);
        wantDist = clamp(this.viewer.fitDistanceFor(localBox) * 1.12,
          fitScene * 0.42, fitScene * 1.02);
        polarGoal = active.dir && Math.abs(active.dir.z) > 0.5 ? 1.02 : 0.88;
      } else {
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

      if (active && active.dir && Math.abs(active.dir.z) < 0.5) {
        const axisIdx = Math.abs(active.dir.x) > 0.5 ? 0 : 1;
        const desired = axisIdx === 0 ? [-Math.PI / 2, Math.PI / 2] : [0, Math.PI];
        let goal = desired[0];
        for (const d of desired) {
          if (Math.abs(wrapPi(d - this._az)) < Math.abs(wrapPi(goal - this._az))) goal = d;
        }
        goal += 0.5 * Math.sign(wrapPi(this._az - goal) || 1);
        this._az += wrapPi(goal - this._az) * Math.min(1, dt * 1.5);
        this._az += 0.02 * dt;
      } else {
        this._az += 0.13 * dt;
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

  // ================= HUD =================
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
      this._partLabel.textContent = `✓ ${n} unidades explodidas`;
    } else if (tSec > 0.01) {
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
