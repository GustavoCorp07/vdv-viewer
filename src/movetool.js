// Movimentação de componentes: gizmo de translação (X/Y/Z), restrição de
// eixos, deslocamento numérico exato, Ctrl+Z e restaurar posições.
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { fmt } from './utils.js';

export class MoveTool {
  constructor(app) {
    this.app = app;
    this.viewer = app.viewer;
    this.panel = document.getElementById('move-panel');
    this.comp = null;
    this.axes = { x: true, y: true, z: true };
    this._dragStart = new THREE.Vector3();

    const tc = new TransformControls(this.viewer.camera, this.viewer.renderer.domElement);
    tc.setMode('translate');
    tc.setSpace('world');
    tc.addEventListener('dragging-changed', (e) => {
      this.viewer.controls.enabled = !e.value;
      if (e.value && this.comp) {
        this._dragStart.copy(this.comp.group.position);
        // membros da montagem/seleção seguem o arrasto em tempo real
        this._followers = this.movingTargets()
          .filter((c) => c !== this.comp)
          .map((c) => ({ comp: c, base: c.group.position.clone() }));
      } else if (!e.value && this.comp) {
        this._suppressClick = true;
        const delta = this.comp.group.position.clone().sub(this._dragStart);
        if (delta.lengthSq() > 1e-6) {
          // o gizmo mexeu em group.position; converte para userOffset
          const targets = [this.comp,
            ...(this._followers || []).map((f) => f.comp)];
          const entries = [];
          for (const c of targets) {
            c.userOffset.add(delta);
            c.applyTransform();
            entries.push({ comp: c, delta: delta.clone() });
          }
          this.app.pushUndo(entries.length > 1
            ? { type: 'multi', entries }
            : { type: 'move', comp: this.comp, delta });
          this.app.props.refresh();
          this.app.setSelStatus();
        } else {
          for (const f of this._followers || []) f.comp.applyTransform();
          this.comp.applyTransform();
        }
        this._followers = null;
      }
    });
    tc.addEventListener('objectChange', () => {
      if (!this.tc.dragging || !this._followers || !this.comp) return;
      const delta = this.comp.group.position.clone().sub(this._dragStart);
      for (const f of this._followers) {
        f.comp.group.position.copy(f.base).add(delta);
      }
    });
    this.tc = tc;
    const helper = tc.getHelper ? tc.getHelper() : tc;
    this.viewer.scene.add(helper);
    this.viewer.gizmoHelper = helper; // ocultado durante o passe de picking
    this.setGizmoVisible(false);
  }

  get gizmoBusy() {
    return this.tc.dragging || !!this.tc.axis;
  }

  /** Evita que o clique disparado ao soltar o gizmo desfaça a seleção.
   *  Suprime APENAS após um arrasto real — as zonas de captura invisíveis
   *  das setas são enormes e engoliriam cliques legítimos nas peças. */
  consumeClickSuppression() {
    const s = this._suppressClick;
    this._suppressClick = false;
    return s;
  }

  setGizmoVisible(v) {
    const helper = this.tc.getHelper ? this.tc.getHelper() : this.tc;
    helper.visible = v;
    this.tc.enabled = v;
  }

  enable() {
    this.renderPanel();
    this.panel.classList.remove('hidden');
    if (this.app.selected) this.attach(this.app.selected);
  }

  disable() {
    this.detach();
    this.panel.classList.add('hidden');
  }

  attach(comp) {
    this.comp = comp;
    this.tc.attach(comp.group);
    this.setGizmoVisible(true);
    this._applyAxes();
    this.renderPanel();
  }

  detach() {
    this.comp = null;
    this.tc.detach();
    this.setGizmoVisible(false);
  }

  _applyAxes() {
    this.tc.showX = this.axes.x;
    this.tc.showY = this.axes.y;
    this.tc.showZ = this.axes.z;
  }

  toggleAxis(axis) {
    this.axes[axis] = !this.axes[axis];
    if (!this.axes.x && !this.axes.y && !this.axes.z) this.axes[axis] = true;
    this._applyAxes();
    this.renderPanel();
  }

  /** Componentes que se movem juntos: seleção múltipla/montagem atual. */
  movingTargets() {
    const sel = this.app.selectionComps();
    if (this.comp && sel.includes(this.comp) && sel.length > 1) return sel;
    return this.comp ? [this.comp] : [];
  }

  applyNumeric(axis, value) {
    if (!this.comp || !isFinite(value) || value === 0) return;
    const delta = new THREE.Vector3();
    delta[axis] = value;
    const targets = this.movingTargets();
    const entries = [];
    for (const c of targets) {
      c.userOffset.add(delta);
      c.applyTransform();
      entries.push({ comp: c, delta: delta.clone() });
    }
    this.app.pushUndo(entries.length > 1
      ? { type: 'multi', entries }
      : { type: 'move', comp: this.comp, delta });
    this.app.props.refresh();
    this.app.setSelStatus();
    const what = this.app.selectedAssembly
      ? `Montagem "${this.app.selectedAssembly.name}"`
      : targets.length > 1 ? `${targets.length} componentes` : `"${this.comp.name}"`;
    this.app.ui.toast(
      `${what} movido(s) ${fmt(value, 1)} mm em ${axis.toUpperCase()}`);
  }

  resetAll() {
    const entries = [];
    for (const c of this.app.model.components) {
      if (c.userOffset.lengthSq() > 1e-6) {
        entries.push({ comp: c, prev: c.userOffset.clone() });
        c.userOffset.set(0, 0, 0);
        c.applyTransform();
      }
    }
    if (!entries.length) {
      this.app.ui.toast('Todos os componentes já estão na posição original.');
      return;
    }
    this.app.pushUndo({ type: 'reset', entries });
    this.app.props.refresh();
    this.app.ui.toast(`${entries.length} componente(s) restaurado(s) à posição original.`, 'success');
  }

  undoEntry(entry) {
    if (entry.type === 'move') {
      entry.comp.userOffset.sub(entry.delta);
      entry.comp.applyTransform();
    } else if (entry.type === 'multi') {
      for (const { comp, delta } of entry.entries) {
        comp.userOffset.sub(delta);
        comp.applyTransform();
      }
    } else if (entry.type === 'reset') {
      for (const { comp, prev } of entry.entries) {
        comp.userOffset.copy(prev);
        comp.applyTransform();
      }
    } else if (entry.type === 'hide') {
      for (const comp of entry.comps) comp.eyeVisible = true;
      this.app.model.applyVisibilityAll();
      this.app.ui.refreshTree();
    }
    this.app.props.refresh();
  }

  renderPanel() {
    const p = this.panel;
    p.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'fp-header';
    header.innerHTML = '<span>Mover componente</span>';
    const close = document.createElement('button');
    close.className = 'fp-close';
    close.textContent = '✕';
    close.addEventListener('click', () => this.app.setMode('select'));
    header.appendChild(close);
    p.appendChild(header);

    const body = document.createElement('div');
    body.className = 'fp-body';

    const toggles = document.createElement('div');
    toggles.className = 'axis-toggles';
    for (const axis of ['x', 'y', 'z']) {
      const b = document.createElement('button');
      b.className = `axis-btn ${axis} ${this.axes[axis] ? 'on' : ''}`;
      b.textContent = axis.toUpperCase();
      b.title = `Habilitar/desabilitar movimento no eixo ${axis.toUpperCase()}`;
      b.addEventListener('click', () => this.toggleAxis(axis));
      toggles.appendChild(b);
    }
    body.appendChild(toggles);

    const numRow = document.createElement('div');
    numRow.className = 'move-num-row';
    const sel = document.createElement('select');
    for (const axis of ['x', 'y', 'z']) {
      const o = document.createElement('option');
      o.value = axis;
      o.textContent = axis.toUpperCase();
      sel.appendChild(o);
    }
    const input = document.createElement('input');
    input.type = 'number';
    input.step = 'any';
    input.placeholder = 'mm';
    const go = document.createElement('button');
    go.className = 'btn-small';
    go.textContent = 'Aplicar';
    go.addEventListener('click', () => {
      this.applyNumeric(sel.value, parseFloat(input.value));
      input.value = '';
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { this.applyNumeric(sel.value, parseFloat(input.value)); input.value = ''; }
    });
    numRow.appendChild(sel);
    numRow.appendChild(input);
    numRow.appendChild(go);
    body.appendChild(numRow);

    const resetBtn = document.createElement('button');
    resetBtn.className = 'btn-small';
    resetBtn.style.width = '100%';
    resetBtn.style.marginBottom = '8px';
    resetBtn.textContent = '⟲ Restaurar todas as posições';
    resetBtn.addEventListener('click', () => this.resetAll());
    body.appendChild(resetBtn);

    const hint = document.createElement('div');
    hint.className = 'move-hint';
    hint.innerHTML = this.comp
      ? `Movendo: <b>${this.comp.name}</b><br/>Arraste as setas do gizmo ou digite um valor. <b>Ctrl+Z</b> desfaz.`
      : 'Clique em um componente para começar a mover. <b>Ctrl+Z</b> desfaz.';
    body.appendChild(hint);

    p.appendChild(body);
  }
}
