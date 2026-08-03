// ============================================================
// Cinemática — gravador e replay de movimentos (estilo SolidWorks
// Motion / Fusion Animation):
//   ● GRAVAR: memoriza câmera (órbita/pan/zoom) a 10 Hz e cada
//     movimento de componente (gizmo, numérico, explosão, manual…);
//   ● OTIMIZAÇÃO IA ao parar: remove tempo morto (pausas > 1,2 s
//     viram 0,35 s), descarta amostras redundantes e o playback
//     interpola com amortecimento crítico — tudo fica fluido;
//   ● REPLAY: play/pause, reverso, loop, velocidade, scrub e
//     exportação da cinemática em VÍDEO WebM Full HD.
// ============================================================
import * as THREE from 'three';
import { clamp } from './utils.js';

const SAMPLE_MS = 100;      // 10 Hz de amostragem da câmera
const IDLE_GAP = 1.2;       // s parado que vira…
const IDLE_KEEP = 0.35;     // …esta pausa compacta
const CAM_EPS = 0.5;        // mm de movimento mínimo para "atividade"

export class CinematicTool {
  constructor(app) {
    this.app = app;
    this.viewer = app.viewer;
    this.recording = false;
    this.playing = false;
    this.reverse = false;
    this.loop = false;
    this.speed = 1;
    this.take = null;        // gravação processada
    this.t = 0;
    this.hud = document.getElementById('cine-hud');
    this._lastNow = 0;
    this._smPos = new THREE.Vector3();
    this._smTarget = new THREE.Vector3();
    this.viewer.onFrame((now) => this._tick(now));
  }

  toggle() {
    if (this.playing) { this._closeReplay(); return; }
    if (this.recording) this._stopRecording();
    else this._startRecording();
  }

  /** Descarta tudo (troca de arquivo, etc.). */
  reset() {
    if (this.recording) {
      this.recording = false;
      this._rec = null;
      this.app.ui.setToggleState('cine', false);
      this.app.ui.setRecording('cine', false);
    }
    this._closeReplay(true);
    this.take = null;
  }

  // ================= Gravação =================
  _startRecording() {
    if (!this.app.model.hasModel) return;
    this._closeReplay(true);
    this.recording = true;
    this._rec = {
      t0: performance.now(),
      lastSample: 0,
      cam: [],                       // {t, pos, target}
      tracks: new Map()              // comp -> [{t, off}]
    };
    // estado inicial de todos os componentes
    for (const c of this.app.model.components) {
      this._rec.tracks.set(c, [{ t: 0, off: c.group.position.clone() }]);
    }
    this._sample(0, true);
    this.app.ui.setToggleState('cine', true);
    this.app.ui.setRecording('cine', true);
    this.app.setStatus(
      '⏺ CINEMÁTICA GRAVANDO — mova componentes, orbite, dê zoom… clique de novo em "Cinemática" para parar e assistir');
    this.app.ui.toast('⏺ Gravação iniciada — tudo o que você fizer será memorizado.', 'success');
  }

  _sample(t, force) {
    const rec = this._rec;
    const cam = this.viewer.camera;
    const target = this.viewer.controls.target;
    const last = rec.cam[rec.cam.length - 1];
    const camMoved = !last ||
      last.pos.distanceTo(cam.position) > CAM_EPS ||
      last.target.distanceTo(target) > CAM_EPS;
    if (force || camMoved) {
      // QUADRO DE RETENÇÃO: a câmera fica cravada onde estava até o
      // instante em que o movimento realmente começa — nada de deriva
      if (last && camMoved && t - last.t > 0.22) {
        rec.cam.push({ t: t - 0.1, pos: last.pos.clone(), target: last.target.clone() });
      }
      rec.cam.push({ t, pos: cam.position.clone(), target: target.clone() });
    }
    for (const c of this.app.model.components) {
      const track = rec.tracks.get(c);
      const lastK = track[track.length - 1];
      if (lastK.off.distanceToSquared(c.group.position) > 0.01) {
        // idem para cada peça: parada até 0,1s antes de mover — a ordem
        // dos movimentos no replay fica IDÊNTICA à gravação
        if (t - lastK.t > 0.22) {
          track.push({ t: t - 0.1, off: lastK.off.clone() });
        }
        track.push({ t, off: c.group.position.clone() });
      }
    }
  }

  _stopRecording() {
    this.recording = false;
    const rec = this._rec;
    this._rec = null;
    this.app.ui.setToggleState('cine', false);
    this.app.ui.setRecording('cine', false);

    const rawDur = (performance.now() - rec.t0) / 1000;
    if (rawDur < 1 || rec.cam.length < 2) {
      this.app.ui.toast('Gravação muito curta — nada para reproduzir.', 'warn');
      this.app.setStatusDefault();
      return;
    }

    // ---- Otimização "IA": remapeia o tempo removendo pausas mortas ----
    const events = [];
    for (let i = 1; i < rec.cam.length; i++) events.push(rec.cam[i].t);
    for (const track of rec.tracks.values()) {
      for (let i = 1; i < track.length; i++) events.push(track[i].t);
    }
    events.sort((a, b) => a - b);
    // constrói o remap: intervalos ociosos > IDLE_GAP encolhem p/ IDLE_KEEP
    const remapKnots = [{ from: 0, to: 0 }];
    let prev = 0, acc = 0;
    for (const e of events) {
      const gap = e - prev;
      acc += gap > IDLE_GAP ? IDLE_KEEP : gap;
      remapKnots.push({ from: e, to: acc });
      prev = e;
    }
    const tailGap = rawDur - prev;
    acc += tailGap > IDLE_GAP ? IDLE_KEEP : tailGap;
    remapKnots.push({ from: rawDur, to: acc });
    const remap = (t) => {
      let lo = 0, hi = remapKnots.length - 1;
      while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (remapKnots[mid].from <= t) lo = mid; else hi = mid;
      }
      const a = remapKnots[lo], b = remapKnots[hi];
      const f = b.from > a.from ? (t - a.from) / (b.from - a.from) : 0;
      return a.to + (b.to - a.to) * f;
    };

    const cam = rec.cam.map((s) => ({ t: remap(s.t), pos: s.pos, target: s.target }));
    const tracks = [];
    for (const [comp, list] of rec.tracks) {
      if (list.length < 2) continue; // componente não se moveu
      tracks.push({
        comp,
        keys: list.map((k) => ({ t: remap(k.t), off: k.off }))
      });
    }
    this.take = { duration: acc, cam, tracks, moved: tracks.length };
    this.app.ui.toast(
      `⏹ Gravação otimizada: ${acc.toFixed(1)}s (${rawDur.toFixed(1)}s brutos), ` +
      `${tracks.length} componente(s) animado(s).`, 'success');
    this._openReplay();
  }

  // ================= Replay =================
  _openReplay() {
    this._buildHud();
    this.hud.classList.remove('hidden');
    this.playing = true;
    this.paused = false;
    this.reverse = false;
    this.t = 0;
    this._lastNow = 0;
    this.viewer.controls.enabled = false;
    this.app.unlockView();
    this.app.setMode('select');
    this.app.select(null);
    const s0 = this._camAt(0);
    this._smPos.copy(s0.pos);
    this._smTarget.copy(s0.target);
    this.app.setStatus(
      '🎬 Replay da cinemática — use os controles abaixo; ✕ devolve o modelo ao estado real');
  }

  _closeReplay(silent) {
    if (!this.playing && !this.take) return;
    this.playing = false;
    this.hud.classList.add('hidden');
    this.viewer.controls.enabled = true;
    // devolve o estado REAL (offsets verdadeiros das peças)
    for (const c of this.app.model.components) c.applyTransform();
    if (!silent) this.app.setStatusDefault();
  }

  _camAt(t) {
    const cam = this.take.cam;
    if (t <= cam[0].t) return cam[0];
    if (t >= cam[cam.length - 1].t) return cam[cam.length - 1];
    let lo = 0, hi = cam.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (cam[mid].t <= t) lo = mid; else hi = mid;
    }
    const a = cam[lo], b = cam[hi];
    const f = (t - a.t) / (b.t - a.t || 1);
    return {
      pos: a.pos.clone().lerp(b.pos, f),
      target: a.target.clone().lerp(b.target, f)
    };
  }

  _applyAt(t, dt) {
    // câmera com amortecimento crítico = movimento sedoso
    const s = this._camAt(t);
    const k = dt != null ? 1 - Math.exp(-dt * 10) : 1;
    this._smPos.lerp(s.pos, k);
    this._smTarget.lerp(s.target, k);
    this.viewer.camera.position.copy(this._smPos);
    this.viewer.controls.target.copy(this._smTarget);
    this.viewer.camera.up.set(0, 0, 1);
    this.viewer.camera.lookAt(this._smTarget);

    for (const tr of this.take.tracks) {
      const keys = tr.keys;
      let off;
      if (t <= keys[0].t) off = keys[0].off;
      else if (t >= keys[keys.length - 1].t) off = keys[keys.length - 1].off;
      else {
        let lo = 0, hi = keys.length - 1;
        while (lo < hi - 1) {
          const mid = (lo + hi) >> 1;
          if (keys[mid].t <= t) lo = mid; else hi = mid;
        }
        const a = keys[lo], b = keys[hi];
        const f = (t - a.t) / (b.t - a.t || 1);
        off = a.off.clone().lerp(b.off, f);
      }
      tr.comp.group.position.copy(off);
    }
  }

  _tick(now) {
    if (this.recording) {
      const t = (now - this._rec.t0) / 1000;
      if (now - this._rec.lastSample >= SAMPLE_MS) {
        this._rec.lastSample = now;
        this._sample(t);
      }
      return;
    }
    if (!this.playing || this.paused) { this._lastNow = now; return; }
    const dt = this._lastNow ? Math.min((now - this._lastNow) / 1000, 0.1) : 0;
    this._lastNow = now;
    this.t += dt * this.speed * (this.reverse ? -1 : 1);

    if (this.t >= this.take.duration || this.t <= 0) {
      if (this.loop) {
        this.t = this.reverse ? this.take.duration : 0;
        const s0 = this._camAt(this.t);
        this._smPos.copy(s0.pos);
        this._smTarget.copy(s0.target);
      } else {
        this.t = clamp(this.t, 0, this.take.duration);
        this.paused = true;
        this._syncHud();
      }
    }
    this._applyAt(this.t, dt);
    this._syncHud();
  }

  // ================= Exportar vídeo =================
  _exportVideo() {
    if (this._exporting) return;
    const r = this.viewer.renderer;
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
      .find((m) => MediaRecorder.isTypeSupported(m));
    if (!mime) {
      this.app.ui.toast('Este navegador não grava vídeo.', 'error');
      return;
    }
    this._exporting = true;
    this._prevAspect = this.viewer.perspCamera.aspect;
    r.setSize(1920, 1080, false);
    this.viewer.perspCamera.aspect = 1920 / 1080;
    this.viewer.perspCamera.updateProjectionMatrix();
    this.viewer._syncOrthoFrustum();
    this.viewer.showTriad = false;

    this.t = 0;
    this.reverse = false;
    this.paused = false;
    const s0 = this._camAt(0);
    this._smPos.copy(s0.pos);
    this._smTarget.copy(s0.target);

    const stream = r.domElement.captureStream(30);
    const chunks = [];
    const recdr = new MediaRecorder(stream, {
      mimeType: mime, videoBitsPerSecond: 16e6
    });
    recdr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recdr.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'vdv-cinematica-1080p.webm';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 8000);
      r.setSize(this.viewer.container.clientWidth, this.viewer.container.clientHeight);
      this.viewer.perspCamera.aspect = this._prevAspect;
      this.viewer.perspCamera.updateProjectionMatrix();
      this.viewer._syncOrthoFrustum();
      this.viewer.showTriad = true;
      this._exporting = false;
      this.app.ui.toast(
        `🎬 Cinemática exportada (${(blob.size / 1e6).toFixed(1)} MB).`, 'success');
    };
    recdr.start(250);
    this.app.ui.toast('🎥 Exportando a cinemática em Full HD…');
    const check = setInterval(() => {
      if (this.t >= this.take.duration || !this.playing) {
        clearInterval(check);
        recdr.stop();
      }
    }, 200);
  }

  // ================= HUD =================
  _buildHud() {
    if (this.hud.dataset.built) { this._syncHud(); return; }
    this.hud.dataset.built = '1';
    this.hud.innerHTML = `
      <span class="hud-title">🎬 Cinemática</span>
      <span class="hud-part" data-role="info"></span>
      <input type="range" min="0" max="1000" value="0" data-role="seek" />
      <select data-role="speed" title="Velocidade">
        <option value="0.5">0,5×</option>
        <option value="1" selected>1×</option>
        <option value="1.5">1,5×</option>
        <option value="2">2×</option>
      </select>
      <button data-act="play" title="Reproduzir / pausar">⏸</button>
      <button data-act="rev" title="Movimento contrário">⏪ Reverso</button>
      <button data-act="loop" title="Repetir continuamente">🔁</button>
      <button data-act="video" title="Exportar em vídeo Full HD">🎥 Vídeo</button>
      <button data-act="again" title="Gravar outra cinemática">⏺ Nova</button>
      <button data-act="close" title="Fechar e voltar ao estado real">✕</button>`;
    const q = (s) => this.hud.querySelector(s);
    q('[data-role="seek"]').addEventListener('input', (e) => {
      this.paused = true;
      this.t = (parseInt(e.target.value, 10) / 1000) * this.take.duration;
      this._applyAt(this.t, null);
      this._smPos.copy(this._camAt(this.t).pos);
      this._smTarget.copy(this._camAt(this.t).target);
      this._syncHud();
    });
    q('[data-role="speed"]').addEventListener('change', (e) => {
      this.speed = parseFloat(e.target.value);
    });
    q('[data-act="play"]').addEventListener('click', () => {
      if (this.t >= this.take.duration && !this.reverse) this.t = 0;
      if (this.t <= 0 && this.reverse) this.t = this.take.duration;
      this.paused = !this.paused;
      this._syncHud();
    });
    q('[data-act="rev"]').addEventListener('click', () => {
      this.reverse = !this.reverse;
      this.paused = false;
      if (this.reverse && this.t <= 0) this.t = this.take.duration;
      if (!this.reverse && this.t >= this.take.duration) this.t = 0;
      this._syncHud();
    });
    q('[data-act="loop"]').addEventListener('click', () => {
      this.loop = !this.loop;
      this._syncHud();
    });
    q('[data-act="video"]').addEventListener('click', () => this._exportVideo());
    q('[data-act="again"]').addEventListener('click', () => {
      this._closeReplay(true);
      this._startRecording();
    });
    q('[data-act="close"]').addEventListener('click', () => this._closeReplay());
  }

  _syncHud() {
    if (!this.hud.dataset.built || !this.take) return;
    const q = (s) => this.hud.querySelector(s);
    q('[data-role="info"]').textContent =
      `${this.t.toFixed(1)}s / ${this.take.duration.toFixed(1)}s • ` +
      `${this.take.moved} peça(s)${this.reverse ? ' • ⏪' : ''}${this.loop ? ' • 🔁' : ''}`;
    q('[data-role="seek"]').value =
      String(Math.round((this.t / this.take.duration) * 1000));
    q('[data-act="play"]').textContent = this.paused ? '▶' : '⏸';
    q('[data-act="rev"]').classList.toggle('on', this.reverse);
    q('[data-act="loop"]').classList.toggle('on', this.loop);
  }
}
