// Ferramenta Renderizar: modo fotorrealista (iluminação por ambiente HDR,
// materiais físicos, sombras suaves, tone mapping ACES) com captura de
// FOTO 4K e VÍDEO 4K (WebM) orbitando o projeto em 360°.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const QUALITIES = {
  fullhd: { label: 'Full HD (1920×1080)', w: 1920, h: 1080, bits: 16e6 },
  uhd4k: { label: '4K Ultra HD (3840×2160)', w: 3840, h: 2160, bits: 45e6 }
};

export class RenderTool {
  constructor(app) {
    this.app = app;
    this.viewer = app.viewer;
    this.active = false;
    this.recording = false;
    this._saved = null;
    this._env = null;
    this.viewer.onFrame((now) => this._tick(now));
  }

  open() {
    if (!this.app.model.hasModel) return;
    this.app.setMode('select');
    this.app.select(null);
    this._enter();

    const content = document.createElement('div');
    content.innerHTML = `
      <p style="font-size:12px;color:#5a6572;margin-bottom:12px">
        O modo fotorrealista já está ativo na viewport (materiais físicos,
        iluminação de estúdio e sombras). Escolha a qualidade e gere a foto
        ou o vídeo orbitando o projeto em 360°.</p>
      <div class="render-row"><span>Qualidade:</span>
        <select data-role="q">
          <option value="fullhd">${QUALITIES.fullhd.label}</option>
          <option value="uhd4k" selected>${QUALITIES.uhd4k.label}</option>
        </select></div>
      <div class="render-row"><span>Duração do vídeo:</span>
        <select data-role="dur">
          <option value="8">8 segundos</option>
          <option value="12" selected>12 segundos</option>
          <option value="20">20 segundos</option>
        </select></div>
      <div class="render-progress hidden" data-role="prog">
        <div class="loading-bar"><div data-role="fill" style="height:100%;width:0%;background:linear-gradient(90deg,#2a7fd4,#4da3ff);border-radius:3px"></div></div>
        <span data-role="ptext">Gravando…</span>
      </div>`;

    this._close = this.app.ui.showModal({
      title: '🎬 Renderizar — ultra realista',
      content,
      actions: [
        { label: '📷 Foto', keepOpen: true, onClick: () => this._photo(content) },
        { label: '🎥 Gravar vídeo 360°', primary: true, keepOpen: true,
          onClick: () => this._record(content) },
        { label: 'Fechar' }
      ],
      onClose: () => {
        if (!this.recording) this._exit();
      }
    });
  }

  // ---------------- Modo fotorrealista ----------------
  _enter() {
    if (this.active) return;
    this.active = true;
    const r = this.viewer.renderer;
    const scene = this.viewer.scene;
    const model = this.app.model;

    if (!this._env) {
      const pmrem = new THREE.PMREMGenerator(r);
      this._env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
    }

    this._saved = {
      mats: model.components.map((c) => ({
        comp: c, mat: c.mesh.material, edges: c.edges.visible
      })),
      toneMapping: r.toneMapping,
      exposure: r.toneMappingExposure
    };

    for (const c of model.components) {
      const src = c.mesh.material;
      const phys = new THREE.MeshPhysicalMaterial({
        color: src.color.clone(),
        map: src.map || null,
        roughness: 0.52,
        metalness: 0.02,
        clearcoat: 0.25,
        clearcoatRoughness: 0.55,
        envMapIntensity: 1.1,
        side: THREE.DoubleSide
      });
      c.mesh.material = phys;
      c.mesh.castShadow = true;
      c.mesh.receiveShadow = true;
      c.edges.visible = false;
    }

    scene.environment = this._env;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;

    // sol com sombras enquadradas no modelo + chão que só recebe sombra
    const box = model.unionBox();
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = size.length() / 2;
    this._sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
    this._sun.position.copy(center).add(
      new THREE.Vector3(radius * 1.2, -radius * 1.4, radius * 2));
    this._sun.target.position.copy(center);
    this._sun.castShadow = true;
    const cam = this._sun.shadow.camera;
    cam.left = -radius * 1.6; cam.right = radius * 1.6;
    cam.top = radius * 1.6; cam.bottom = -radius * 1.6;
    cam.near = 1; cam.far = radius * 8;
    this._sun.shadow.mapSize.set(2048, 2048);
    this._sun.shadow.bias = -0.0004;
    scene.add(this._sun);
    scene.add(this._sun.target);

    this._ground = new THREE.Mesh(
      new THREE.PlaneGeometry(radius * 8, radius * 8),
      new THREE.ShadowMaterial({ opacity: 0.22 }));
    this._ground.position.set(center.x, center.y, box.min.z - 0.5);
    this._ground.receiveShadow = true;
    scene.add(this._ground);

    this.viewer.showTriad = false;
    this.app.ui.toast('Modo fotorrealista ativado.', 'success');
  }

  _exit() {
    if (!this.active) return;
    this.active = false;
    const r = this.viewer.renderer;
    for (const s of this._saved.mats) {
      s.comp.mesh.material.dispose();
      s.comp.mesh.material = s.mat;
      s.comp.mesh.castShadow = false;
      s.comp.mesh.receiveShadow = false;
      s.comp.edges.visible = s.edges;
    }
    this.viewer.scene.environment = null;
    r.toneMapping = this._saved.toneMapping;
    r.toneMappingExposure = this._saved.exposure;
    r.shadowMap.enabled = false;
    this.viewer.scene.remove(this._sun, this._sun.target, this._ground);
    this._ground.geometry.dispose();
    this._ground.material.dispose();
    this._sun = null;
    this._ground = null;
    this.viewer.showTriad = true;
    this._saved = null;
  }

  // ---------------- Foto ----------------
  _photo(content) {
    const q = QUALITIES[content.querySelector('[data-role="q"]').value];
    const r = this.viewer.renderer;
    const camAspect = this.viewer.camera.aspect;
    r.setSize(q.w, q.h, false);
    this.viewer.camera.aspect = q.w / q.h;
    this.viewer.camera.updateProjectionMatrix();
    this.viewer.render();
    const url = r.domElement.toDataURL('image/png');
    r.setSize(this.viewer.container.clientWidth,
      this.viewer.container.clientHeight);
    this.viewer.camera.aspect = camAspect;
    this.viewer.camera.updateProjectionMatrix();
    const a = document.createElement('a');
    a.href = url;
    a.download = `vdv-render-${q.w}x${q.h}.png`;
    a.click();
    this.app.ui.toast(`📷 Foto ${q.w}×${q.h} salva.`, 'success');
  }

  // ---------------- Vídeo 360° ----------------
  _record(content) {
    if (this.recording) return;
    const q = QUALITIES[content.querySelector('[data-role="q"]').value];
    const dur = parseInt(content.querySelector('[data-role="dur"]').value, 10);
    const r = this.viewer.renderer;
    const canvas = r.domElement;

    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
      .find((m) => MediaRecorder.isTypeSupported(m));
    if (!mime) {
      this.app.ui.toast('Este navegador não suporta gravação de vídeo.', 'error');
      return;
    }

    // buffer em resolução alvo (o CSS continua no tamanho da janela)
    this._prevAspect = this.viewer.camera.aspect;
    r.setSize(q.w, q.h, false);
    this.viewer.camera.aspect = q.w / q.h;
    this.viewer.camera.updateProjectionMatrix();

    const box = this.app.model.unionBox();
    const s0 = this.viewer.controls.getSpherical();
    this._rec = {
      t0: performance.now(),
      dur: dur * 1000,
      az0: s0.az,
      center: box.getCenter(new THREE.Vector3()),
      dist: this.viewer.fitDistanceFor(box) * 1.18,
      prog: content.querySelector('[data-role="prog"]'),
      fill: content.querySelector('[data-role="fill"]'),
      ptext: content.querySelector('[data-role="ptext"]')
    };
    this._rec.prog.classList.remove('hidden');
    this.viewer.controls.enabled = false;

    const stream = canvas.captureStream(30);
    this._chunks = [];
    this._recorder = new MediaRecorder(stream, {
      mimeType: mime, videoBitsPerSecond: q.bits
    });
    this._recorder.ondataavailable = (e) => {
      if (e.data.size) this._chunks.push(e.data);
    };
    this._recorder.onstop = () => this._finishRecording(q);
    this._recorder.start(250);
    this.recording = true;
    this.app.setStatus(`🎥 Renderizando vídeo ${q.w}×${q.h} — orbitando o projeto…`);
  }

  _tick(now) {
    if (!this.recording || !this._rec) return;
    const rec = this._rec;
    const t = Math.min((now - rec.t0) / rec.dur, 1);
    const az = rec.az0 + t * Math.PI * 2;
    const polar = 1.0 + 0.16 * Math.sin(t * Math.PI * 2 * 0.6);
    this.viewer.controls.setSpherical(az, polar, rec.dist, rec.center);
    rec.fill.style.width = (t * 100).toFixed(1) + '%';
    rec.ptext.textContent = `Gravando… ${Math.round(t * 100)}%`;
    if (t >= 1) {
      this.recording = false;
      this._recorder.stop();
    }
  }

  _finishRecording(q) {
    const blob = new Blob(this._chunks, { type: 'video/webm' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `vdv-render-360-${q.w}x${q.h}.webm`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 8000);

    const r = this.viewer.renderer;
    r.setSize(this.viewer.container.clientWidth,
      this.viewer.container.clientHeight);
    this.viewer.camera.aspect = this._prevAspect;
    this.viewer.camera.updateProjectionMatrix();
    this.viewer.controls.enabled = true;
    if (this._rec) this._rec.prog.classList.add('hidden');
    this._rec = null;
    this.app.ui.toast(
      `🎬 Vídeo ${q.w}×${q.h} salvo (${(blob.size / 1e6).toFixed(1)} MB).`, 'success');
    this.app.setStatusDefault();
  }
}
