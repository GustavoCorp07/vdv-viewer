// Navegação 3D no padrão SolidWorks:
//   Botão do meio + arrastar  = Orbitar (em torno do ponto sob o cursor)
//   Ctrl + botão do meio      = Pan
//   Shift + botão do meio     = Zoom por arrasto
//   Scroll                    = Zoom direcionado ao cursor
// Eixo Z para cima (turntable).
import * as THREE from 'three';

const MIN_DIST = 5;        // mm
const MAX_DIST = 500000;   // mm
const POLAR_MIN = 0.02;
const POLAR_MAX = Math.PI - 0.02;

export class CadControls {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {HTMLElement} dom
   * @param {(ev: PointerEvent|WheelEvent) => THREE.Vector3|null} pickPoint
   *        callback que retorna o ponto 3D sob o cursor (ou null)
   */
  constructor(camera, dom, pickPoint) {
    this.camera = camera;
    this.dom = dom;
    this.pickPoint = pickPoint;
    this.target = new THREE.Vector3();
    this.enabled = true;

    this._mode = null; // 'orbit' | 'pan' | 'zoomdrag'
    this._pivot = new THREE.Vector3();
    this._last = { x: 0, y: 0 };

    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onWheel = this._onWheel.bind(this);
    this._onDblClick = this._onDblClick.bind(this);

    dom.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);
    dom.addEventListener('wheel', this._onWheel, { passive: false });
    dom.addEventListener('dblclick', this._onDblClick);

    this.onFit = null; // atribuído pelo viewer (duplo clique do meio = fit)
  }

  dispose() {
    this.dom.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    this.dom.removeEventListener('wheel', this._onWheel);
    this.dom.removeEventListener('dblclick', this._onDblClick);
  }

  get distance() { return this.camera.position.distanceTo(this.target); }

  /** true enquanto o usuário orbita/pan/zoom com o botão do meio. */
  get navigating() { return this._mode !== null; }

  _onPointerDown(ev) {
    if (!this.enabled || ev.button !== 1) return;
    ev.preventDefault();
    this._mode = ev.ctrlKey ? 'pan' : ev.shiftKey ? 'zoomdrag' : 'orbit';
    this._last.x = ev.clientX;
    this._last.y = ev.clientY;
    if (this._mode === 'orbit') {
      const p = this.pickPoint ? this.pickPoint(ev) : null;
      this._pivot.copy(p || this.target);
    }
    this.dom.style.cursor = this._mode === 'pan' ? 'move' : 'grabbing';
  }

  _onPointerMove(ev) {
    if (!this._mode || !this.enabled) return;
    const dx = ev.clientX - this._last.x;
    const dy = ev.clientY - this._last.y;
    this._last.x = ev.clientX;
    this._last.y = ev.clientY;

    if (this._mode === 'orbit') this._orbit(dx, dy);
    else if (this._mode === 'pan') this._pan(dx, dy);
    else this._dolly(Math.exp(dy * 0.004));
  }

  _onPointerUp(ev) {
    if (ev.button === 1 && this._mode) {
      this._mode = null;
      this.dom.style.cursor = '';
      if (this.onNavEnd) this.onNavEnd();
    }
  }

  _onDblClick(ev) {
    // duplo clique do botão do meio não dispara dblclick; usamos o esquerdo
    // apenas quando não há componente sob o cursor (tratado no viewer)
  }

  _orbit(dx, dy) {
    const cam = this.camera;
    const ROT = 0.0065;

    // Azimute: rotação em torno do eixo Z do mundo passando pelo pivô
    const qAz = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1), -dx * ROT
    );

    // Elevação: limita o passo por evento para NUNCA cruzar o polo
    // (validar apenas o resultado deixaria um arrasto rápido atravessar
    // e inverter a vista em 180°)
    const dirNow = new THREE.Vector3().subVectors(this.target, cam.position).normalize();
    const polarNow = Math.acos(THREE.MathUtils.clamp(-dirNow.z, -1, 1));
    const polarNew = THREE.MathUtils.clamp(polarNow - dy * ROT, POLAR_MIN, POLAR_MAX);
    const dEl = polarNew - polarNow; // rotação em torno de "right" soma ao polar

    const right = new THREE.Vector3().crossVectors(dirNow, cam.up).normalize();
    const qEl = new THREE.Quaternion().setFromAxisAngle(right, dEl);
    const q = new THREE.Quaternion().multiplyQuaternions(qAz, qEl);

    cam.position.sub(this._pivot).applyQuaternion(q).add(this._pivot);
    this.target.sub(this._pivot).applyQuaternion(q).add(this._pivot);
    cam.up.set(0, 0, 1);
    cam.lookAt(this.target);
  }

  _pan(dx, dy) {
    const cam = this.camera;
    const dist = this.distance;
    const height = this.dom.clientHeight || 1;
    const worldPerPx = (2 * dist * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)) / height;

    const viewDir = new THREE.Vector3().subVectors(this.target, cam.position).normalize();
    const right = new THREE.Vector3().crossVectors(viewDir, cam.up).normalize();
    const upScreen = new THREE.Vector3().crossVectors(right, viewDir).normalize();

    const offset = right.multiplyScalar(-dx * worldPerPx)
      .add(upScreen.multiplyScalar(dy * worldPerPx));
    cam.position.add(offset);
    this.target.add(offset);
    cam.lookAt(this.target);
  }

  _dolly(scale, focus = null) {
    const cam = this.camera;
    const p = focus || this.target;
    const newDist = this.camera.position.distanceTo(p) * scale;
    if (newDist < MIN_DIST || newDist > MAX_DIST) return;
    cam.position.sub(p).multiplyScalar(scale).add(p);
    this.target.sub(p).multiplyScalar(scale).add(p);
    cam.lookAt(this.target);
  }

  _onWheel(ev) {
    if (!this.enabled) return;
    ev.preventDefault();
    const scale = Math.exp(ev.deltaY * 0.0012); // scroll p/ cima = aproximar
    const p = this.pickPoint ? this.pickPoint(ev) : null;
    this._dolly(scale, p);
  }

  /** Posiciona a câmera olhando o alvo a partir de (azimute, polar, distância). */
  setSpherical(az, polar, dist, target) {
    if (target) this.target.copy(target);
    const p = THREE.MathUtils.clamp(polar, POLAR_MIN, POLAR_MAX);
    const sin = Math.sin(p);
    this.camera.position.set(
      this.target.x + dist * sin * Math.cos(az),
      this.target.y + dist * sin * Math.sin(az),
      this.target.z + dist * Math.cos(p)
    );
    this.camera.up.set(0, 0, 1);
    this.camera.lookAt(this.target);
  }

  /** Esféricas atuais em relação ao alvo: { az, polar, dist } */
  getSpherical() {
    const off = new THREE.Vector3().subVectors(this.camera.position, this.target);
    const dist = off.length();
    return {
      az: Math.atan2(off.y, off.x),
      polar: Math.acos(THREE.MathUtils.clamp(off.z / dist, -1, 1)),
      dist
    };
  }
}
