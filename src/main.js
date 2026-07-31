// VdvView 3D — orquestrador principal: modos, seleção, eventos de mouse e
// teclado, carregamento de arquivos e ligação entre todos os módulos.
import { Viewer } from './viewer.js';
import { ModelManager } from './model.js';
import { parseStep } from './loader.js';
import { LayerSystem } from './layers.js';
import { PropertiesPanel } from './properties.js';
import { MoveTool } from './movetool.js';
import { ExplodeTool } from './explode.js';
import { MeasureTool } from './measure.js';
import { BomTool } from './bom.js';
import { UI } from './ui.js';
import { Auth } from './auth.js';
import { CloudExplorer } from './cloud.js';
import { fmtMM } from './utils.js';

const STATUS_BY_MODE = {
  select:
    'Clique: selecionar • Botão do meio: orbitar • Ctrl+meio: pan • Shift+meio ou scroll: zoom • F: enquadrar',
  properties: 'Modo Propriedades — clique em um componente para ver todos os dados',
  move: 'Modo Mover — clique em um componente e arraste as setas do gizmo • Ctrl+Z desfaz',
  measure: 'Modo Medir — clique em dois pontos da geometria para medir em mm'
};

class App {
  constructor() {
    this.viewer = new Viewer(document.getElementById('viewport'));
    this.model = new ModelManager(this.viewer);
    this.ui = new UI(this);
    this.layers = new LayerSystem(this);
    this.props = new PropertiesPanel(this);
    this.move = new MoveTool(this);
    this.explode = new ExplodeTool(this);
    this.measure = new MeasureTool(this);
    this.bom = new BomTool(this);

    this.mode = 'select';
    this.selected = null;              // peça primária
    this.selectedComps = new Set();    // seleção completa (multi/montagem)
    this.selectedAssembly = null;
    this.undoStack = [];
    this.section = { enabled: false, axis: 'z', t: 0.5, flip: false };
    this.present = { active: false, last: 0, t: 0 };

    this.model.layerVisibilityFn = (comp) => this.layers.isVisible(comp);

    this.ui.init();
    this._bindPointer();
    this._bindKeyboard();
    this._bindFileInputs();

    this.viewer.onFrame((now) => this._presentTick(now));
    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement && this.present.active) this.exitPresent();
    });

    // ---- Nuvem: autenticação + explorador + rotas de compartilhamento ----
    this.lastBuffer = null;
    this.lastFileName = '';
    this._cloudSlug = null;
    this.auth = new Auth(this);
    this.cloud = new CloudExplorer(this);
    document.getElementById('logout-btn')
      .addEventListener('click', () => this.auth.logout());
    window.addEventListener('hashchange', () => this._handleRoute());
    this.auth.init();
  }

  // ================= Sessão =================
  onLoggedIn() {
    const chip = document.getElementById('user-chip');
    chip.classList.remove('hidden');
    document.getElementById('user-name').textContent =
      '👤 ' + (this.auth.user ? this.auth.user.display_name : '');
    this._handleRoute();
  }

  onLoggedOut() {
    document.getElementById('user-chip').classList.add('hidden');
    this.cloud.close();
  }

  /** Rota #/p/<slug>: abre o projeto compartilhado após o login. */
  _handleRoute() {
    const m = location.hash.match(/^#\/p\/([a-z0-9]+)/i);
    if (!m) return;
    const slug = m[1];
    if (slug === this._cloudSlug) return; // já aberto
    if (!this.auth.user) return;          // abre após o login (init re-chama)
    this.cloud.openBySlug(slug);
  }

  /** Registra o slug do projeto aberto e reflete na URL. */
  setCloudSlug(slug) {
    this._cloudSlug = slug;
    const want = slug ? '#/p/' + slug : '';
    if (location.hash !== want) {
      if (slug) location.hash = want;
      else history.replaceState(null, '',
        location.pathname + location.search);
    }
  }

  // ================= Estado do projeto na nuvem =================
  /** Captura modificações (posições, ocultos, layers, montagens). */
  captureCloudState() {
    const comps = this.model.components;
    const idx = (c) => comps.indexOf(c);
    return {
      v: 1,
      offsets: comps.map((c) => [
        +c.userOffset.x.toFixed(3),
        +c.userOffset.y.toFixed(3),
        +c.userOffset.z.toFixed(3)]),
      hidden: comps.map((c) => (c.eyeVisible ? 0 : 1)),
      layers: this.layers.layers
        .filter((l) => l.name || l.members.size)
        .map((l) => ({
          id: l.id, name: l.name, active: l.active,
          members: [...l.members].map(idx).filter((i) => i >= 0)
        })),
      assemblies: this.model.assemblies.map((a) => ({
        name: a.name,
        members: a.members.map(idx).filter((i) => i >= 0)
      }))
    };
  }

  /** Reaplica um estado salvo (após _loadBuffer do mesmo arquivo). */
  applyCloudState(state) {
    this.ui.loading(false);
    if (!state || !Array.isArray(state.offsets)) return;
    const comps = this.model.components;
    state.offsets.forEach((o, i) => {
      if (comps[i] && Array.isArray(o)) {
        comps[i].userOffset.set(o[0] || 0, o[1] || 0, o[2] || 0);
        comps[i].applyTransform();
      }
    });
    (state.hidden || []).forEach((h, i) => {
      if (comps[i] && h) comps[i].eyeVisible = false;
    });
    for (const l of state.layers || []) {
      const layer = this.layers.layers[l.id];
      if (!layer) continue;
      layer.name = l.name || '';
      layer.active = l.active !== false;
      layer.members = new Set(
        (l.members || []).map((i) => comps[i]).filter(Boolean));
      for (const m of layer.members) m.layerId = layer.id;
    }
    for (const a of state.assemblies || []) {
      const members = (a.members || []).map((i) => comps[i]).filter(Boolean);
      if (members.length >= 2) this.model.createAssembly(a.name, members);
    }
    this.layers.refreshBar();
    this.model.applyVisibilityAll();
    this.ui.refreshTree();
  }

  // ================= Modos =================
  setMode(mode) {
    if (this.mode === mode) return;
    const prev = this.mode;
    this.mode = mode;

    if (prev === 'move') this.move.disable();
    if (prev === 'measure') this.measure.clear();
    if (prev === 'properties' && mode !== 'properties') this.props.hide();

    if (mode === 'move') this.move.enable();

    this.ui.refreshModeButtons();
    this.setStatusDefault();
  }

  setStatus(text) { this.ui.setStatus(text); }

  setStatusDefault() {
    if (this.layers.capture) return;
    this.ui.setStatus(STATUS_BY_MODE[this.mode] || STATUS_BY_MODE.select);
  }

  // ================= Seleção =================
  /**
   * Seleciona um componente. Peças de uma montagem selecionam a montagem
   * inteira (bloco único). `opts.additive` (Ctrl+clique) alterna a
   * peça/montagem na seleção múltipla sem limpar as demais.
   */
  select(comp, opts = {}) {
    const additive = !!opts.additive;
    if (!comp) {
      this.selected = null;
      this.selectedComps = new Set();
      this.selectedAssembly = null;
    } else {
      const unit = comp.assembly ? comp.assembly.members : [comp];
      if (additive) {
        const removing = this.selectedComps.has(comp);
        for (const c of unit) {
          if (removing) this.selectedComps.delete(c);
          else this.selectedComps.add(c);
        }
        this.selected = removing
          ? ([...this.selectedComps].pop() || null)
          : comp;
        this.selectedAssembly = null;
        if (!this.selectedComps.size) this.selected = null;
      } else {
        this.selectedComps = new Set(unit);
        this.selected = comp;
        this.selectedAssembly = comp.assembly || null;
      }
    }
    this._afterSelectionChanged();
  }

  /** Seleciona uma montagem inteira (clique no nó da árvore). */
  selectAssembly(asm, opts = {}) {
    if (opts.additive) {
      const removing = asm.members.every((m) => this.selectedComps.has(m));
      for (const m of asm.members) {
        if (removing) this.selectedComps.delete(m);
        else this.selectedComps.add(m);
      }
      this.selected = [...this.selectedComps].pop() || null;
      this.selectedAssembly = null;
    } else {
      this.selectedComps = new Set(asm.members);
      this.selected = asm.members[0] || null;
      this.selectedAssembly = asm;
    }
    this._afterSelectionChanged();
  }

  _afterSelectionChanged() {
    this.viewer.setSelectedMulti([...this.selectedComps], this.selected);
    if (this.model.xray) this.model.applyVisibilityAll();
    this.ui.refreshTree();
    this.setSelStatus();

    if (this.selected) {
      if (this.mode === 'properties' && this.selectedComps.size === 1) {
        this.props.showFor(this.selected);
      }
      if (this.mode === 'move') this.move.attach(this.selected);
    } else {
      this.props.hide();
      if (this.mode === 'move') this.move.detach();
    }
  }

  /** Componentes que se movem juntos na seleção atual. */
  selectionComps() {
    return [...this.selectedComps];
  }

  setSelStatus() {
    if (this.selectedAssembly) {
      this.ui.setSelectionStatus(
        `📦 Montagem "${this.selectedAssembly.name}" — ${this.selectedAssembly.members.length} peça(s)`);
    } else if (this.selectedComps.size > 1) {
      this.ui.setSelectionStatus(`${this.selectedComps.size} componentes selecionados`);
    } else if (this.selected) {
      const d = this.selected.dims;
      this.ui.setSelectionStatus(
        `${this.selected.name} — ${fmtMM(d.c)} × ${fmtMM(d.l)} × ${fmtMM(d.e)}`);
    } else {
      this.ui.setSelectionStatus('');
    }
  }

  // ================= Montagens =================
  async createAssemblyFromSelection() {
    const comps = this.selectionComps();
    if (comps.length < 2) {
      this.ui.toast('Selecione 2 ou mais componentes (Ctrl+clique) para criar uma montagem.', 'warn');
      return;
    }
    const name = await this.ui.promptText({
      title: '📦 Criar montagem',
      label: `${comps.length} componentes selecionados. Nome da montagem:`,
      placeholder: 'ex.: Gaveta, Porta dupla, Módulo superior…'
    });
    if (name == null) return;
    const asm = this.model.createAssembly(name, comps);
    this.selectAssembly(asm);
    this.ui.toast(`Montagem "${asm.name}" criada com ${asm.members.length} peça(s). ` +
      'Ela agora se move e explode como um bloco único.', 'success');
  }

  dissolveAssembly(asm) {
    const name = asm.name;
    this.model.dissolveAssembly(asm);
    this.select(null);
    this.ui.toast(`Montagem "${name}" desfeita — as peças voltaram a ser independentes.`);
  }

  hideSelection() {
    const comps = this.selectionComps();
    for (const c of comps) c.eyeVisible = false;
    this.select(null);
    this.model.applyVisibilityAll();
    this.ui.refreshTree();
    this.ui.toast(`${comps.length} componente(s) ocultado(s) — use "Mostrar tudo" para reexibir.`);
  }

  zoomSelection() {
    const comps = this.selectionComps();
    if (!comps.length) return;
    const box = comps[0].currentAABB();
    for (const c of comps.slice(1)) box.union(c.currentAABB());
    this.viewer.fitBox(box);
  }

  // ================= Eventos de mouse =================
  _bindPointer() {
    const dom = this.viewer.container;

    // impede autoscroll do botão do meio e menu nativo
    dom.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());

    // hover — extraído para poder ser reavaliado quando a CÂMERA muda
    // (zoom/órbita/enquadrar) com o cursor parado; sem isso o destaque
    // fica preso na peça que estava sob o mouse antes do movimento.
    this._lastPointer = null;
    this._hoverTip = document.getElementById('hover-tip');

    dom.addEventListener('pointermove', (e) => {
      this._lastPointer = { clientX: e.clientX, clientY: e.clientY };
      this._updateHover(this._lastPointer);
    });
    dom.addEventListener('pointerleave', () => {
      this._lastPointer = null;
      this.viewer.setHover(null);
      this._hoverTip.classList.add('hidden');
    });
    // câmera mudou (scroll, tween, explosão recolhendo…): reavalia o hover
    this.viewer.onCameraChanged = () => {
      if (this._lastPointer) this._updateHover(this._lastPointer);
    };
    // fim de órbita/pan: restaura o destaque imediatamente
    this.viewer.controls.onNavEnd = () => {
      if (this._lastPointer) this._updateHover(this._lastPointer);
    };

    // clique esquerdo: captura de layer (diálogo aberto) OU seleção
    dom.addEventListener('click', (e) => {
      if (!this.model.hasModel || this.explode.playing) return;
      if (this.move.consumeClickSuppression()) return;
      const hit = this.viewer.pickComponent(e);

      if (this.layers.capture) {
        if (hit) this.layers.captureToggle(hit.comp);
        return;
      }
      if (this.mode === 'measure') {
        this.measure.onClick(hit);
        return;
      }
      if (hit) {
        this.select(hit.comp, { additive: e.ctrlKey });
        if (this.mode === 'properties' && !e.ctrlKey) this.props.showFor(hit.comp);
      } else if (!e.ctrlKey) {
        this.select(null);
      }
    });

    // clique direito: menu de contexto (suprimido durante a captura de layer)
    dom.addEventListener('contextmenu', (e) => {
      if (!this.model.hasModel || this.explode.playing) return;
      if (this.layers.capture) return;
      const hit = this.viewer.pickComponent(e);
      if (hit) this.showContextMenu(e.clientX, e.clientY, hit.comp);
    });

    // arrastar e soltar arquivo
    const dropOverlay = document.getElementById('drop-overlay');
    window.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropOverlay.classList.remove('hidden');
    });
    window.addEventListener('dragleave', (e) => {
      if (!e.relatedTarget) dropOverlay.classList.add('hidden');
    });
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      dropOverlay.classList.add('hidden');
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file && /\.(step|stp)$/i.test(file.name)) this.loadFile(file);
      else if (file) this.ui.toast('Formato não suportado — use .step ou .stp', 'error');
    });
  }

  /** Reavalia o destaque/tooltip da peça sob o cursor. */
  _updateHover(pos) {
    const dom = this.viewer.container;
    if (!this.model.hasModel || this.explode.playing || this.present.active ||
        this.viewer.controls.navigating ||
        (this.mode === 'move' && this.move.gizmoBusy)) {
      this.viewer.setHover(null);
      this._hoverTip.classList.add('hidden');
      return;
    }
    const hit = this.viewer.pickComponent(pos);
    this.viewer.setHover(hit ? hit.comp : null);
    dom.style.cursor = hit ? 'pointer' : '';
    if (hit) {
      this._hoverTip.textContent = hit.comp.name;
      this._hoverTip.classList.remove('hidden');
      const wrap = dom.getBoundingClientRect();
      this._hoverTip.style.left = pos.clientX - wrap.left + 14 + 'px';
      this._hoverTip.style.top = pos.clientY - wrap.top + 18 + 'px';
    } else {
      this._hoverTip.classList.add('hidden');
    }
  }

  showContextMenu(x, y, comp) {
    // seleção múltipla ativa e o alvo faz parte dela → menu de grupo
    if (this.selectedComps.size > 1 && this.selectedComps.has(comp)) {
      const n = this.selectedComps.size;
      const items = [];
      if (this.selectedAssembly) {
        items.push({ label: '⛓ Desfazer montagem',
          onClick: () => this.dissolveAssembly(this.selectedAssembly) });
      } else {
        items.push({ label: `📦 Criar montagem (${n} peças)…`,
          onClick: () => this.createAssemblyFromSelection() });
      }
      items.push(
        { label: `👁 Ocultar seleção (${n})`, onClick: () => this.hideSelection() },
        { label: '🔍 Zoom na seleção', onClick: () => this.zoomSelection() },
        { label: '✥ Mover seleção', onClick: () => this.setMode('move') }
      );
      const title = this.selectedAssembly
        ? `📦 ${this.selectedAssembly.name}` : `${n} componentes`;
      this.ui.contextMenu(x, y, title, items);
      return;
    }

    const items = [
      { label: '🛈 Propriedades', onClick: () => { this.select(comp); this.props.showFor(comp); } },
      { label: '🔍 Zoom na peça', onClick: () => { this.select(comp); this.viewer.fitBox(comp.currentAABB()); } },
      { label: '👁 Ocultar', onClick: () => {
          comp.eyeVisible = false;
          this.model.applyVisibilityAll();
          this.ui.refreshTree();
        } },
      { label: '◎ Isolar', onClick: () => { this.select(comp); this.toggleIsolate(true); } },
      { label: '✥ Mover esta peça', onClick: () => { this.select(comp); this.setMode('move'); } }
    ];
    if (comp.assembly) {
      items.unshift({ label: `⛓ Desfazer montagem "${comp.assembly.name}"`,
        onClick: () => this.dissolveAssembly(comp.assembly) });
    }
    this.ui.contextMenu(x, y, comp.name, items);
  }

  // ================= Modo Apresentar =================
  togglePresent() {
    if (this.present.active) { this.exitPresent(); return; }
    if (!this.model.hasModel) return;
    this.setMode('select');
    this.ui.hideContextMenu();
    const box = this.model.unionBox();
    this.present = {
      active: true, last: 0, t: 0,
      fit: this.viewer.fitDistanceFor(box) * 1.12,
      center: box.getCenter(this.viewer.controls.target.clone()),
      az: this.viewer.controls.getSpherical().az
    };
    this.viewer.controls.enabled = false;
    document.getElementById('app').classList.add('presenting');
    const hint = document.getElementById('present-hint');
    hint.classList.remove('hidden');
    hint.style.animation = 'none';
    void hint.offsetWidth;
    hint.style.animation = '';
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
    this.ui.setToggleState('present', true);
    setTimeout(() => window.dispatchEvent(new Event('resize')), 80);
  }

  exitPresent() {
    if (!this.present.active) return;
    this.present.active = false;
    document.getElementById('app').classList.remove('presenting');
    document.getElementById('present-hint').classList.add('hidden');
    this.viewer.controls.enabled = true;
    this.ui.setToggleState('present', false);
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
    setTimeout(() => window.dispatchEvent(new Event('resize')), 80);
    this.fitAll();
  }

  _presentTick(now) {
    if (!this.present.active) return;
    if (!this.present.last) { this.present.last = now; return; }
    const dt = Math.min((now - this.present.last) / 1000, 0.1);
    this.present.last = now;
    this.present.t += dt;
    const t = this.present.t;
    // órbita suave contínua + onda de elevação + respiração de zoom
    this.present.az += dt * 0.14;
    const polar = 1.0 + 0.20 * Math.sin(t * 0.21);
    const dist = this.present.fit * (1 + 0.05 * Math.sin(t * 0.13));
    this.viewer.controls.setSpherical(this.present.az, polar, dist, this.present.center);
  }

  // ================= Teclado =================
  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      if (e.ctrlKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        this.undo();
      } else if (e.key.toLowerCase() === 'f' && this.model.hasModel) {
        this.fitAll();
      } else if (e.key === 'Escape') {
        if (this.present.active) { this.exitPresent(); return; }
        if (this.layers.capture) { this.layers.cancelCapture(); return; }
        if (this.explode.playing) { this.explode.skip(); return; }
        this.ui.hideContextMenu();
        this.measure.clear();
        if (this.model.isolatedComp) this.toggleIsolate(false);
        if (this.mode !== 'select') this.setMode('select');
        else this.select(null);
      }
    });
  }

  // ================= Undo =================
  pushUndo(entry) {
    this.undoStack.push(entry); // pilha ilimitada (entradas são pequenas)
  }

  undo() {
    const entry = this.undoStack.pop();
    if (!entry) {
      this.ui.toast('Nada para desfazer.');
      return;
    }
    this.move.undoEntry(entry);
    this.ui.toast('Movimento desfeito (Ctrl+Z).');
    this.setSelStatus();
  }

  // ================= Exibição =================
  fitAll() {
    const box = this.model.unionBox();
    if (!box.isEmpty()) this.viewer.fitBox(box);
  }

  toggleIsolate(force) {
    const on = typeof force === 'boolean'
      ? force
      : !this.model.isolatedComp;
    if (on && !this.selected) {
      this.ui.toast('Selecione um componente para isolar.', 'warn');
      return;
    }
    this.model.isolatedComp = on ? this.selected : null;
    this.model.applyVisibilityAll();
    this.ui.refreshTree();
    this.ui.setToggleState('isolate', on);
    if (on) this.ui.toast(`Isolando "${this.selected.name}" — Esc para sair.`);
  }

  toggleXray() {
    this.model.xray = !this.model.xray;
    this.model.applyVisibilityAll();
    this.ui.setToggleState('xray', this.model.xray);
  }

  toggleSection(force) {
    const on = typeof force === 'boolean' ? force : !this.section.enabled;
    this.section.enabled = on;
    document.getElementById('section-panel').classList.toggle('hidden', !on);
    this.ui.setToggleState('section', on);
    this.ui.syncSectionPanel();
    this.applySection();
  }

  applySection() {
    this.viewer.setSection(
      { ...this.section, box: this.model.originalBox() },
      this.model.allMaterials());
    this.ui.syncSectionPanel();
  }

  showAll() {
    for (const c of this.model.components) c.eyeVisible = true;
    this.model.isolatedComp = null;
    for (const l of this.layers.layers) l.active = true;
    this.ui.setToggleState('isolate', false);
    this.layers.refreshBar();
    this.model.applyVisibilityAll();
    this.ui.refreshTree();
    this.ui.toast('Todos os componentes visíveis (layers reativadas).', 'success');
  }

  // ================= Arquivos =================
  _bindFileInputs() {
    const input = document.getElementById('file-input');
    input.addEventListener('change', () => {
      if (input.files && input.files[0]) this.loadFile(input.files[0]);
      input.value = '';
    });
    document.getElementById('welcome-open')
      .addEventListener('click', () => this.openFilePicker());
    document.getElementById('welcome-demo')
      .addEventListener('click', () => this.loadDemo());
  }

  openFilePicker() {
    document.getElementById('file-input').click();
  }

  async loadDemo() {
    try {
      this.ui.loading(true, 'Baixando modelo de demonstração…');
      const resp = await fetch('./demo/demo-gabinete.step');
      if (!resp.ok) throw new Error('Modelo de demonstração não encontrado.');
      const buffer = await resp.arrayBuffer();
      await this._loadBuffer(buffer, 'Gabinete-Demo.step');
    } catch (err) {
      this.ui.loading(false);
      this.ui.toast('Erro: ' + err.message, 'error');
      console.error(err);
    }
  }

  async loadFile(file) {
    try {
      this.ui.loading(true, `Processando "${file.name}"…`);
      const buffer = await file.arrayBuffer();
      await this._loadBuffer(buffer, file.name);
    } catch (err) {
      this.ui.loading(false);
      this.ui.toast('Erro ao abrir o arquivo: ' + err.message, 'error');
      console.error(err);
    }
  }

  async _loadBuffer(buffer, name) {
    this.ui.loading(true, `Processando "${name}" no kernel OpenCASCADE…`);
    const result = await parseStep(buffer);
    this.lastBuffer = buffer;   // retido para "Salvar na nuvem"
    this.lastFileName = name;
    this.setCloudSlug(null);    // novo arquivo ≠ projeto da nuvem

    // limpa estado anterior
    this.explode.close();
    this.measure.clear();
    this.select(null);
    this.undoStack = [];
    this.layers.reset();
    if (this.section.enabled) this.toggleSection(false);
    this.model.xray = false;
    this.ui.setToggleState('xray', false);
    this.ui.setToggleState('isolate', false);
    this.setMode('select');

    this.model.build(result, name);
    this.ui.loading(false);
    this.ui.welcome(false);

    const comps = this.model.components.length;
    const w = this.model.weightSummary();
    this.ui.setFileInfo(name, comps, this.model.triangleCount(), w);
    this.ui.refreshEnabled();
    this.ui.refreshTree();

    const box = this.model.unionBox();
    box.getCenter(this.viewer.controls.target);
    this.viewer.setView('iso', box);

    this.ui.toast(`"${name}" aberto: ${comps} componente(s) independentes.`, 'success');
    this.setStatusDefault();
  }
}

window.vdvApp = new App();
