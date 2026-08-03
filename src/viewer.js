// Viewport 3D: renderer, câmera, luzes, picking, destaque, tríade de eixos,
// vistas padrão, plano de seção e captura de tela.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CadControls } from './controls.js';
import { TweenManager, easeInOutCubic, clamp } from './utils.js';

export const HOVER_COLOR = 0x5a2d00;    // laranja (emissivo) — padrão SolidWorks
export const SELECT_COLOR = 0x0e4d22;   // verde (emissivo)
export const DANGER_COLOR = 0x641111;   // vermelho (interferências)
export const STAGED_COLOR = 0x0a4a5a;   // ciano (captura de layer)

export class Viewer {
  constructor(container) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.localClippingEnabled = true;
    // visual realista por padrão: tone mapping cinematográfico + sombras
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    // iluminação por ambiente (IBL) — reflexos e luz difusa de estúdio
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.modelGroup = new THREE.Group();
    this.scene.add(this.modelGroup);
    this.overlayGroup = new THREE.Group(); // medições etc. (sem picking)
    this.scene.add(this.overlayGroup);

    this.perspCamera = new THREE.PerspectiveCamera(45, 1, 1, 1000000);
    this.orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 1000000);
    this.camera = this.perspCamera;      // ativa (persp por padrão)
    this.projection = 'persp';
    this.onProjectionChanged = null;
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(900, -900, 650);
    this.camera.lookAt(0, 0, 0);

    this._setupLights();
    this._setupTriad();

    this.controls = new CadControls(this.camera, container, (ev) => this.pickPoint(ev));
    this.tweens = new TweenManager();

    this.raycaster = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();

    this.hoverComp = null;
    this.selectedComp = null;        // seleção primária (gizmo, raio-x)
    this.selectedComps = new Set();  // seleção completa (multi/montagem)
    this.dangerComps = new Set();
    this.stagedComps = new Set();

    this.sectionPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
    this.sectionEnabled = false;

    this._frameCbs = [];
    this._pickables = [];
    this._comps = [];
    this.gizmoHelper = null;

    // GPU picking (IDs por cor): a peça escolhida é EXATAMENTE a que está
    // pintada sob o cursor — imune a faces coplanares empatadas. Abertura
    // 5×5 px: com zoom afastado, peças finas (bordas de 15 mm) viram
    // lascas de ~1 px e o pixel central pode cair no fundo.
    this.pickTarget = new THREE.WebGLRenderTarget(5, 5);
    this.pickBuf = new Uint8Array(5 * 5 * 4);

    this._resize = this._resize.bind(this);
    window.addEventListener('resize', this._resize);
    this._resize();

    this._animate = this._animate.bind(this);
    requestAnimationFrame(this._animate);
  }

  _setupLights() {
    // o ambiente HDR fornece a luz difusa; estas complementam forma e sombra
    const hemi = new THREE.HemisphereLight(0xffffff, 0x8f98a3, 0.3);
    hemi.position.set(0, 0, 1);
    this.scene.add(hemi);

    this.keyLight = new THREE.DirectionalLight(0xfff6e8, 1.6);
    this.keyLight.position.set(0.8, -0.6, 1.1);
    this.scene.add(this.keyLight);
    this.scene.add(this.keyLight.target);

    const fill = new THREE.DirectionalLight(0xdfe8f5, 0.3);
    fill.position.set(-0.7, 0.8, 0.35);
    this.scene.add(fill);
  }

  /**
   * Prepara o palco realista para o modelo carregado: sol com sombras
   * enquadradas na cena e "chão" invisível que só recebe sombra.
   */
  stageForModel(box) {
    if (!box || box.isEmpty()) {
      if (this.ground) this.ground.visible = false;
      this.keyLight.castShadow = false;
      return;
    }
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() / 2, 100);

    const key = this.keyLight;
    key.castShadow = true;
    key.position.copy(center).add(
      new THREE.Vector3(radius * 1.1, -radius * 1.3, radius * 1.9));
    key.target.position.copy(center);
    const sc = key.shadow.camera;
    sc.left = -radius * 1.8; sc.right = radius * 1.8;
    sc.top = radius * 1.8; sc.bottom = -radius * 1.8;
    sc.near = 1; sc.far = radius * 8;
    sc.updateProjectionMatrix();
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0004;
    if (key.shadow.map) { key.shadow.map.dispose(); key.shadow.map = null; }

    if (!this.ground) {
      this.ground = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.ShadowMaterial({ opacity: 0.20 }));
      this.ground.receiveShadow = true;
      this.scene.add(this.ground);
    }
    this.ground.scale.set(radius * 12, radius * 12, 1);
    this.ground.position.set(center.x, center.y, box.min.z - 0.5);
    this.ground.visible = true;
  }

  _setupTriad() {
    this.triadScene = new THREE.Scene();
    this.triadCamera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    const origin = new THREE.Vector3();
    const mk = (dir, color, label) => {
      const arrow = new THREE.ArrowHelper(dir, origin, 1.5, color, 0.42, 0.2);
      arrow.line.material.linewidth = 2;
      this.triadScene.add(arrow);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 64;
      const ctx = canvas.getContext('2d');
      ctx.font = 'bold 42px Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#' + new THREE.Color(color).getHexString();
      ctx.fillText(label, 32, 34);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(canvas), depthTest: false
      }));
      sprite.position.copy(dir).multiplyScalar(2.0);
      sprite.scale.setScalar(0.62);
      this.triadScene.add(sprite);
    };
    mk(new THREE.Vector3(1, 0, 0), 0xd24545, 'X');
    mk(new THREE.Vector3(0, 1, 0), 0x2c9c4b, 'Y');
    mk(new THREE.Vector3(0, 0, 1), 0x2e6fd0, 'Z');
  }

  _resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.perspCamera.aspect = w / h;
    this.perspCamera.updateProjectionMatrix();
    this._syncOrthoFrustum();
  }

  /**
   * Alterna a projeção da câmera. As vistas travadas usam ORTOGRÁFICA
   * (paralela, padrão TopSolid/SolidWorks: zero distorção de perspectiva).
   */
  setProjection(mode) {
    if (mode === this.projection) return;
    const from = this.camera;
    const to = mode === 'ortho' ? this.orthoCamera : this.perspCamera;
    to.position.copy(from.position);
    to.up.copy(from.up);
    to.quaternion.copy(from.quaternion);
    this.camera = to;
    this.controls.camera = to;
    this.projection = mode;
    if (mode === 'ortho') this._syncOrthoFrustum();
    else this.perspCamera.updateProjectionMatrix();
    if (this.onProjectionChanged) this.onProjectionChanged(to);
  }

  /**
   * O frustum ortográfico é derivado da DISTÂNCIA atual (meia-altura =
   * dist·tan(fov/2)): todo o resto — zoom no cursor, pan, enquadrar —
   * funciona idêntico à perspectiva sem nenhuma matemática nova.
   */
  _syncOrthoFrustum() {
    if (this.projection !== 'ortho') return;
    const cam = this.orthoCamera;
    const dist = this.controls.distance;
    const buf = this.renderer.domElement;
    const aspect = (buf.width || 1) / (buf.height || 1);
    const halfH = dist * Math.tan(THREE.MathUtils.degToRad(45) / 2);
    const halfW = halfH * aspect;
    cam.left = -halfW; cam.right = halfW;
    cam.top = halfH; cam.bottom = -halfH;
    cam.updateProjectionMatrix();
  }

  onFrame(cb) { this._frameCbs.push(cb); }

  setComponents(comps) {
    this._comps = comps;
    this._pickables = comps.map((c) => c.mesh);
  }

  _animate(now) {
    requestAnimationFrame(this._animate);
    this.tweens.update(now);
    for (const cb of this._frameCbs) cb(now);
    this._updateClipPlanes();
    this._syncOrthoFrustum();
    this._detectCameraChange();
    this.render();
  }

  /**
   * Near/far dinâmicos em função da distância de visualização (padrão CAD).
   * Com near fixo em 1 mm, a resolução do z-buffer degrada com o QUADRADO
   * da distância: com zoom afastado o viés de polygonOffset chegava a
   * dezenas de mm e peças recuadas eram pintadas NA FRENTE das externas —
   * era isso que fazia o clique "pegar outra peça" de longe.
   */
  _updateClipPlanes() {
    const dist = this.controls.distance;
    const near = THREE.MathUtils.clamp(dist * 0.01, 0.1, 500);
    const far = THREE.MathUtils.clamp(dist * 200, 20000, 5e6);
    if (Math.abs(near - this.camera.near) / near > 0.1 ||
        Math.abs(far - this.camera.far) / far > 0.1) {
      this.camera.near = this.projection === 'ortho' ? 0.1 : near;
      this.camera.far = far;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Notifica quando a câmera muda (zoom/órbita/tween) para o app
   *  reavaliar o hover sob o cursor parado — sem isso o destaque fica
   *  "preso" na peça que estava sob o mouse ANTES do movimento. */
  _detectCameraChange() {
    if (!this._camPos) {
      this._camPos = this.camera.position.clone();
      this._camQuat = this.camera.quaternion.clone();
      return;
    }
    const moved =
      this._camPos.distanceToSquared(this.camera.position) > 1e-6 ||
      Math.abs(1 - this._camQuat.dot(this.camera.quaternion)) > 1e-9;
    if (moved) {
      this._camPos.copy(this.camera.position);
      this._camQuat.copy(this.camera.quaternion);
      if (this.onCameraChanged) this.onCameraChanged();
    }
  }

  render() {
    const r = this.renderer;
    r.autoClear = true;
    // usa o tamanho do buffer (não o CSS): na renderização 4K o buffer
    // é maior que a janela e o viewport precisa cobri-lo por inteiro
    const pr = r.getPixelRatio();
    r.setViewport(0, 0, r.domElement.width / pr, r.domElement.height / pr);
    r.render(this.scene, this.camera);

    // Tríade de eixos no canto inferior esquerdo
    if (this.showTriad === false) return;
    const size = 96;
    r.autoClear = false;
    r.clearDepth();
    r.setViewport(10, 10, size, size);
    r.setScissor(10, 10, size, size);
    r.setScissorTest(true);
    const dir = new THREE.Vector3()
      .subVectors(this.camera.position, this.controls.target).normalize();
    this.triadCamera.position.copy(dir).multiplyScalar(6.2);
    this.triadCamera.up.copy(this.camera.up);
    this.triadCamera.lookAt(0, 0, 0);
    r.render(this.triadScene, this.triadCamera);
    r.setScissorTest(false);
    r.autoClear = true;
  }

  // ---------- Picking ----------
  _setPointerFromEvent(ev) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this._pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    this._pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  }

  /**
   * Passe de picking na GPU: renderiza 1 pixel da cena com cada peça numa
   * cor-ID chapada e lê o pixel — o resultado é idêntico ao que o usuário vê
   * na tela (mesmo z-buffer, mesmos offsets), com precisão de pixel.
   */
  _gpuPick(ev) {
    if (!this._comps.length) return null;
    const canvas = this.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    if (ev.clientX < rect.left || ev.clientX >= rect.right ||
        ev.clientY < rect.top || ev.clientY >= rect.bottom) return null;
    const bw = canvas.width, bh = canvas.height; // pixels físicos
    const x = Math.min(bw - 1, Math.max(0,
      Math.floor((ev.clientX - rect.left) / rect.width * bw)));
    const y = Math.min(bh - 1, Math.max(0,
      Math.floor((ev.clientY - rect.top) / rect.height * bh)));

    // troca materiais por IDs e esconde tudo que não é peça
    const restore = [];
    for (const c of this._comps) {
      restore.push([c, c.mesh.material, c.edges.visible]);
      c.mesh.material = c.pickMaterial;
      c.edges.visible = false;
    }
    const hidden = [];
    const hide = (o) => { if (o && o.visible) { hidden.push(o); o.visible = false; } };
    hide(this.overlayGroup);
    hide(this.gizmoHelper);

    // janela 5×5 centrada no cursor (clampada às bordas do canvas)
    const offX = Math.max(0, Math.min(bw - 5, x - 2));
    const offY = Math.max(0, Math.min(bh - 5, y - 2));
    const cx = x - offX; // posição do cursor dentro da janela (0..4)
    const cy = y - offY;

    const r = this.renderer;
    this.camera.setViewOffset(bw, bh, offX, offY, 5, 5);
    const prevClear = new THREE.Color();
    r.getClearColor(prevClear);
    const prevAlpha = r.getClearAlpha();
    r.setRenderTarget(this.pickTarget);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(this.scene, this.camera);
    r.readRenderTargetPixels(this.pickTarget, 0, 0, 5, 5, this.pickBuf);
    r.setRenderTarget(null);
    r.setClearColor(prevClear, prevAlpha);
    this.camera.clearViewOffset();

    for (const [c, mat, edgeVis] of restore) {
      c.mesh.material = mat;
      c.edges.visible = edgeVis;
    }
    for (const o of hidden) o.visible = true;

    // lê a janela: prioridade absoluta para o pixel do cursor; senão, o
    // vizinho não-vazio mais próximo (facilita clicar em lascas de ~1 px)
    const idAt = (wx, wyTop) => {
      const row = 4 - wyTop; // readPixels devolve linhas de baixo para cima
      const o = (row * 5 + wx) * 4;
      return this.pickBuf[o] | (this.pickBuf[o + 1] << 8) | (this.pickBuf[o + 2] << 16);
    };
    let id = idAt(cx, cy);
    if (!id) {
      let bestD = Infinity;
      for (let wy = 0; wy < 5; wy++) {
        for (let wx = 0; wx < 5; wx++) {
          const v = idAt(wx, wy);
          if (!v) continue;
          const d = (wx - cx) * (wx - cx) + (wy - cy) * (wy - cy);
          if (d < bestD) { bestD = d; id = v; }
        }
      }
    }
    if (!id || id > this._comps.length) return null;
    const comp = this._comps[id - 1];
    return comp && comp.group.visible ? comp : null;
  }

  /** Retorna { comp, point, face } do componente visível sob o cursor, ou null. */
  pickComponent(ev) {
    const comp = this._gpuPick(ev);
    if (!comp) return null;
    // ponto 3D preciso, lançando o raio apenas contra a peça já identificada
    this._setPointerFromEvent(ev);
    this.raycaster.setFromCamera(this._pointer, this.camera);
    const hits = this.raycaster.intersectObject(comp.mesh, false);
    let point = null, faceIndex = null, face = null;
    for (const h of hits) {
      if (this.sectionEnabled &&
          this.sectionPlane.distanceToPoint(h.point) < 0) continue;
      point = h.point.clone();
      faceIndex = h.faceIndex;
      face = h.face;
      break;
    }
    if (!point) {
      point = comp.currentAABB(new THREE.Box3()).getCenter(new THREE.Vector3());
    }
    return { comp, point, faceIndex, face, object: comp.mesh };
  }

  /** Ponto 3D sob o cursor (pivô de órbita / zoom) — raycast leve, sem GPU.
   *  SEM geometria sob o cursor, ancora no plano do alvo: o zoom nunca
   *  "puxa" a vista de volta para o centro do projeto. */
  pickPoint(ev) {
    this._setPointerFromEvent(ev);
    this.raycaster.setFromCamera(this._pointer, this.camera);
    if (this._pickables.length) {
      const hits = this.raycaster.intersectObjects(this._pickables, false);
      for (const h of hits) {
        const comp = h.object.userData.comp;
        if (!comp || !comp.group.visible) continue;
        if (this.sectionEnabled &&
            this.sectionPlane.distanceToPoint(h.point) < 0) continue;
        return h.point.clone();
      }
    }
    // plano perpendicular à vista passando pelo alvo (profundidade neutra)
    const viewDir = new THREE.Vector3();
    this.camera.getWorldDirection(viewDir);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      viewDir, this.controls.target);
    const out = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(plane, out) ? out : null;
  }

  // ---------- Destaques ----------
  _applyEmissive(comp) {
    if (!comp) return;
    let color = 0x000000;
    if (this.dangerComps.has(comp)) color = DANGER_COLOR;
    else if (this.stagedComps.has(comp)) color = STAGED_COLOR;
    else if (this.selectedComps.has(comp)) color = SELECT_COLOR;
    else if (comp === this.hoverComp) color = HOVER_COLOR;
    comp.mesh.material.emissive.setHex(color);
  }

  setHover(comp) {
    if (comp === this.hoverComp) return;
    const prev = this.hoverComp;
    this.hoverComp = comp;
    this._applyEmissive(prev);
    this._applyEmissive(comp);
  }

  setSelected(comp) {
    this.setSelectedMulti(comp ? [comp] : [], comp);
  }

  /** Seleção múltipla: `comps` recebem o verde de seleção; `primary` é a
   *  peça de referência (gizmo, raio-x). */
  setSelectedMulti(comps, primary) {
    const prev = [...this.selectedComps];
    this.selectedComps = new Set(comps || []);
    this.selectedComp = primary || (comps && comps[0]) || null;
    for (const c of prev) this._applyEmissive(c);
    for (const c of this.selectedComps) this._applyEmissive(c);
  }

  setDanger(comps) {
    const prev = [...this.dangerComps];
    this.dangerComps = new Set(comps || []);
    for (const c of prev) this._applyEmissive(c);
    for (const c of this.dangerComps) this._applyEmissive(c);
  }

  setStaged(comps) {
    const prev = [...this.stagedComps];
    this.stagedComps = new Set(comps || []);
    for (const c of prev) this._applyEmissive(c);
    for (const c of this.stagedComps) this._applyEmissive(c);
  }

  // ---------- Enquadramento e vistas ----------
  fitDistanceFor(box) {
    const size = box.getSize(new THREE.Vector3());
    const radius = size.length() / 2 || 100;
    // sempre em termos da perspectiva: a ortográfica deriva o frustum
    // da mesma distância, então o enquadramento fica idêntico
    const fov = THREE.MathUtils.degToRad(this.perspCamera.fov);
    const aspect = this.perspCamera.aspect || 1;
    const fitH = radius / Math.sin(fov / 2);
    const fitW = radius / Math.sin(Math.atan(Math.tan(fov / 2) * aspect));
    return Math.max(fitH, fitW) * 1.06;
  }

  fitBox(box, animate = true) {
    if (!box || box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const dist = this.fitDistanceFor(box);
    const { az, polar } = this.controls.getSpherical();
    this._flyTo(az, polar, dist, center, animate ? 550 : 0);
  }

  /** Posiciona a câmera EXATAMENTE na vista ortográfica (0° de inclinação). */
  applyExactView(name, box) {
    const center = box && !box.isEmpty()
      ? box.getCenter(new THREE.Vector3())
      : this.controls.target.clone();
    const dist = box && !box.isEmpty()
      ? this.fitDistanceFor(box) : this.controls.distance;
    const offsets = {
      frente: [0, -dist, 0], tras: [0, dist, 0],
      esquerda: [-dist, 0, 0], direita: [dist, 0, 0],
      topo: [0, 0, dist], base: [0, 0, -dist]
    };
    const off = offsets[name];
    if (!off) return;
    this.controls.target.copy(center);
    this.camera.position.set(
      center.x + off[0], center.y + off[1], center.z + off[2]);
    this.camera.up.set(0, 0, name === 'topo' || name === 'base' ? 0 : 1);
    if (name === 'topo' || name === 'base') this.camera.up.set(0, 1, 0);
    this.camera.lookAt(center);
  }

  setView(name, box, opts) {
    // vistas EXATAS, sem nenhuma inclinação (topo/base a 0,03° do polo —
    // matematicamente estável e visualmente perfeito)
    const views = {
      iso:      { az: -Math.PI / 4 - Math.PI / 2, polar: Math.PI / 3 },
      frente:   { az: -Math.PI / 2, polar: Math.PI / 2 },
      tras:     { az: Math.PI / 2, polar: Math.PI / 2 },
      esquerda: { az: Math.PI, polar: Math.PI / 2 },
      direita:  { az: 0, polar: Math.PI / 2 },
      topo:     { az: -Math.PI / 2, polar: 0.0005 },
      base:     { az: -Math.PI / 2, polar: Math.PI - 0.0005 }
    };
    const v = views[name];
    if (!v) return;
    const center = box && !box.isEmpty()
      ? box.getCenter(new THREE.Vector3())
      : this.controls.target.clone();
    const dist = box && !box.isEmpty() ? this.fitDistanceFor(box) : this.controls.distance;
    this._flyTo(v.az, v.polar, dist, center, 550,
      opts && opts.exact ? () => this.applyExactView(name, box) : null);
  }

  _flyTo(az, polar, dist, target, duration = 550, onComplete = null) {
    const start = this.controls.getSpherical();
    const startTarget = this.controls.target.clone();
    if (duration <= 0) {
      this.controls.setSpherical(az, polar, dist, target);
      if (onComplete) onComplete();
      return;
    }
    // caminho angular mais curto
    let dAz = az - start.az;
    while (dAz > Math.PI) dAz -= 2 * Math.PI;
    while (dAz < -Math.PI) dAz += 2 * Math.PI;

    this.tweens.add({
      duration,
      ease: easeInOutCubic,
      onUpdate: (t) => {
        const tg = startTarget.clone().lerp(target, t);
        this.controls.setSpherical(
          start.az + dAz * t,
          start.polar + (polar - start.polar) * t,
          start.dist + (dist - start.dist) * t,
          tg
        );
      },
      onComplete
    });
  }

  // ---------- Plano de seção ----------
  /** cfg: { enabled, axis: 'x'|'y'|'z', t: 0..1, flip: bool, box: Box3 } */
  setSection(cfg, materials) {
    this.sectionEnabled = cfg.enabled;
    if (cfg.enabled && cfg.box && !cfg.box.isEmpty()) {
      const n = new THREE.Vector3(
        cfg.axis === 'x' ? -1 : 0,
        cfg.axis === 'y' ? -1 : 0,
        cfg.axis === 'z' ? -1 : 0
      );
      if (cfg.flip) n.negate();
      const min = cfg.box.min[cfg.axis], max = cfg.box.max[cfg.axis];
      const pos = min + (max - min) * clamp(cfg.t, 0, 1);
      // plano: n·p + c = 0 → mantém o lado onde n·p + c > 0
      const c = cfg.flip ? -pos : pos;
      this.sectionPlane.normal.copy(n);
      this.sectionPlane.constant = c;
    }
    const planes = this.sectionEnabled ? [this.sectionPlane] : [];
    for (const m of materials) m.clippingPlanes = planes;
  }

  // ---------- Captura ----------
  screenshot(fileName = 'vdvview-captura.png') {
    const prevRatio = this.renderer.getPixelRatio();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio * 2, 3));
    this._resize();
    this.render();

    const src = this.renderer.domElement;
    const out = document.createElement('canvas');
    out.width = src.width;
    out.height = src.height;
    const ctx = out.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, out.height);
    grad.addColorStop(0, '#f5f8fb');
    grad.addColorStop(0.42, '#dee7f0');
    grad.addColorStop(1, '#b4c4d6');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(src, 0, 0);

    this.renderer.setPixelRatio(prevRatio);
    this._resize();

    const a = document.createElement('a');
    a.href = out.toDataURL('image/png');
    a.download = fileName;
    a.click();
  }
}
