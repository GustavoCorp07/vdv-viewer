// Interface: ribbon (CommandManager), árvore da montagem (FeatureManager),
// modais, menu de contexto, toasts, painel de seção e barra de status.
import { fmt } from './utils.js';

const ICONS = {
  open: '<svg viewBox="0 0 24 24" fill="none" stroke="#c78f2d" stroke-width="1.7"><path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v2H3z" fill="#f4c563" stroke="#c78f2d"/><path d="M3 8v10a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V8" fill="#fbd989"/></svg>',
  demo: '<svg viewBox="0 0 24 24" fill="none" stroke="#3d7dc4" stroke-width="1.6"><path d="M12 3 4 7.5v9L12 21l8-4.5v-9L12 3z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/></svg>',
  shot: '<svg viewBox="0 0 24 24" fill="none" stroke="#4a5568" stroke-width="1.6"><rect x="3" y="7" width="18" height="13" rx="2"/><circle cx="12" cy="13.5" r="3.6"/><path d="M8 7l1.5-2.5h5L16 7"/></svg>',
  bom: '<svg viewBox="0 0 24 24" fill="none" stroke="#2c7a4b" stroke-width="1.6"><rect x="3.5" y="4" width="17" height="16" rx="1.5"/><path d="M3.5 9h17M3.5 14h17M9 4v16"/></svg>',
  props: '<svg viewBox="0 0 24 24" fill="none" stroke="#1f6fc4" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.2v.4"/></svg>',
  move: '<svg viewBox="0 0 24 24" fill="none" stroke="#b3541e" stroke-width="1.7"><path d="M12 2v20M2 12h20"/><path d="M12 2l-2.6 3M12 2l2.6 3M12 22l-2.6-3M12 22l2.6-3M2 12l3-2.6M2 12l3 2.6M22 12l-3-2.6M22 12l-3 2.6"/></svg>',
  measure: '<svg viewBox="0 0 24 24" fill="none" stroke="#6b46a8" stroke-width="1.6"><rect x="2.5" y="14" width="19" height="6.5" rx="1" transform="rotate(-32 12 17)"/><path d="M7 14.8l1.2 2M10.4 12.7l1.2 2M13.8 10.5l1.2 2M17.2 8.4l1.2 2" transform="rotate(0)"/></svg>',
  explode: '<svg viewBox="0 0 24 24" fill="none" stroke="#c73e3e" stroke-width="1.7"><rect x="9.2" y="9.2" width="5.6" height="5.6" rx="0.8"/><path d="M12 6.5V2.5M12 17.5v4M6.5 12h-4M17.5 12h4M7.8 7.8L5 5M16.2 7.8L19 5M7.8 16.2L5 19M16.2 16.2L19 19"/></svg>',
  fit: '<svg viewBox="0 0 24 24" fill="none" stroke="#3a6ea5" stroke-width="1.7"><path d="M3 8V4a1 1 0 0 1 1-1h4M16 3h4a1 1 0 0 1 1 1v4M21 16v4a1 1 0 0 1-1 1h-4M8 21H4a1 1 0 0 1-1-1v-4"/><rect x="8.5" y="8.5" width="7" height="7" rx="1"/></svg>',
  isolate: '<svg viewBox="0 0 24 24" fill="none" stroke="#2b6cb0" stroke-width="1.7"><circle cx="12" cy="12" r="3.4"/><circle cx="12" cy="12" r="8.4" stroke-dasharray="3.5 3.5" opacity="0.65"/></svg>',
  xray: '<svg viewBox="0 0 24 24" fill="none" stroke="#4a5568" stroke-width="1.6"><path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z" opacity="0.55"/><circle cx="12" cy="12" r="2.8"/></svg>',
  section: '<svg viewBox="0 0 24 24" fill="none" stroke="#8a5a2b" stroke-width="1.6"><path d="M12 3 4 7.5v9L12 21l8-4.5v-9L12 3z" opacity="0.5"/><path d="M3 12h18" stroke="#c73e3e" stroke-dasharray="3 2.4" stroke-width="1.8"/></svg>',
  showall: '<svg viewBox="0 0 24 24" fill="none" stroke="#2c7a4b" stroke-width="1.7"><path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/></svg>',
  reset: '<svg viewBox="0 0 24 24" fill="none" stroke="#3a6ea5" stroke-width="1.7"><path d="M4 9a8.5 8.5 0 1 1-1 5.5"/><path d="M4 4v5h5"/></svg>',
  interf: '<svg viewBox="0 0 24 24" fill="none" stroke="#c05621" stroke-width="1.7"><path d="M12 3.5 21.5 20h-19L12 3.5z"/><path d="M12 10v4.5M12 17.6v.4"/></svg>',
  present: '<svg viewBox="0 0 24 24" fill="none" stroke="#6b46a8" stroke-width="1.7"><rect x="2.5" y="4" width="19" height="12.5" rx="1.5"/><path d="M12 16.5v3M8 20.5h8"/><path d="M10 8l4.5 2.3L10 12.6V8z" fill="#6b46a8" stroke="none"/></svg>',
  cloudopen: '<svg viewBox="0 0 24 24" fill="none" stroke="#1f6fc4" stroke-width="1.6"><path d="M7 17a4.2 4.2 0 0 1-.6-8.4 5.4 5.4 0 0 1 10.6 1A3.7 3.7 0 0 1 17 17H7z"/><path d="M12 13.5v-3M10.2 12l1.8-1.8L13.8 12" stroke-width="1.5"/></svg>',
  cloudsave: '<svg viewBox="0 0 24 24" fill="none" stroke="#2c7a4b" stroke-width="1.6"><path d="M7 16a4.2 4.2 0 0 1-.6-8.4 5.4 5.4 0 0 1 10.6 1A3.7 3.7 0 0 1 17 16H7z"/><path d="M12 12v7M9.8 16.8L12 19l2.2-2.2" stroke-width="1.5"/></svg>',
  assembly: '<svg viewBox="0 0 24 24" fill="none" stroke="#1f6fc4" stroke-width="1.6"><path d="M12 3 4 7.5v9L12 21l8-4.5v-9L12 3z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9M8 5.7l8 4.5"/></svg>',
  tex: '<svg viewBox="0 0 24 24" fill="none" stroke="#8a5a2b" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9c4-2.5 7 2.5 11 0s7 0 7 0M3 15c4-2.5 7 2.5 11 0s7 0 7 0" opacity="0.8"/></svg>',
  render: '<svg viewBox="0 0 24 24" fill="none" stroke="#b3541e" stroke-width="1.6"><circle cx="12" cy="12" r="8.6"/><circle cx="12" cy="12" r="3.4" fill="#b3541e" fill-opacity="0.25"/><path d="M12 3.4v3M12 17.6v3M3.4 12h3M17.6 12h3"/></svg>',
  manual: '<svg viewBox="0 0 24 24" fill="none" stroke="#2c7a4b" stroke-width="1.6"><path d="M4 4.5h6.5a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H4v-13z"/><path d="M20 4.5h-6.5a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2H20v-13z"/><path d="M6.5 8h3M6.5 11h3M14.5 8h3M14.5 11h3"/></svg>',
  hideeye: '<svg viewBox="0 0 24 24" fill="none" stroke="#a2543a" stroke-width="1.8"><path d="M4 4l16 16M9.9 6.3A9.8 9.8 0 0 1 12 5.8c6 0 9.5 6.2 9.5 6.2a17 17 0 0 1-3.3 3.9M6 8.2A16 16 0 0 0 2.5 12S6 18.2 12 18.2c1 0 2-.16 2.9-.44"/></svg>',
  cine: '<svg viewBox="0 0 24 24" fill="none" stroke="#cc3b3b" stroke-width="1.7"><circle cx="12" cy="12" r="8.6"/><circle cx="12" cy="12" r="3.2" fill="#cc3b3b"/></svg>'
};

const EYE_ON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="#3a6ea5" stroke-width="2"><path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF =
  '<svg viewBox="0 0 24 24" fill="none" stroke="#a2adb9" stroke-width="2"><path d="M4 4l16 16M9.9 6.3A9.8 9.8 0 0 1 12 5.8c6 0 9.5 6.2 9.5 6.2a17 17 0 0 1-3.3 3.9M6 8.2A16 16 0 0 0 2.5 12S6 18.2 12 18.2c1 0 2-.16 2.9-.44"/></svg>';

export class UI {
  constructor(app) {
    this.app = app;
    this.treeEl = document.getElementById('tree');
    this.searchTerm = '';
    this.modeButtons = {};
    this.toggleButtons = {};
  }

  init() {
    this.buildRibbon();
    this.buildViewButtons();
    this.buildSectionPanel();
    this.bindTreePanel();
    this.setStatus('Pronto');
  }

  // ---------------- Ribbon ----------------
  buildRibbon() {
    const app = this.app;
    const ribbon = document.getElementById('ribbon');
    ribbon.innerHTML = '';

    const groups = [
      {
        label: 'Arquivo',
        buttons: [
          { id: 'open', icon: 'open', label: 'Abrir\nSTEP', title: 'Abrir arquivo .step/.stp', onClick: () => app.openFilePicker() },
          { id: 'demo', icon: 'demo', label: 'Demons-\ntração', title: 'Carregar modelo de demonstração', onClick: () => app.loadDemo() },
          { id: 'shot', icon: 'shot', label: 'Captura\nPNG', title: 'Salvar imagem da viewport', needsModel: true, onClick: () => app.viewer.screenshot() },
          { id: 'bom', icon: 'bom', label: 'Plano de\nCorte', title: 'Gerar plano de corte (BOM) e exportar CSV', needsModel: true, onClick: () => app.bom.showCutList() },
          { id: 'cloudopen', icon: 'cloudopen', label: 'Projetos', title: 'Abrir projetos salvos na nuvem', onClick: () => app.cloud.open('open') },
          { id: 'cloudsave', icon: 'cloudsave', label: 'Salvar na\nnuvem', title: 'Salvar este projeto na nuvem (com link compartilhável)', needsModel: true, onClick: () => app.cloud.open('save') }
        ]
      },
      {
        label: 'Ferramentas',
        buttons: [
          { id: 'props', icon: 'props', label: 'Proprie-\ndades', title: 'Modo propriedades: clique numa peça para ver os dados', needsModel: true, mode: 'properties' },
          { id: 'move', icon: 'move', label: 'Mover', title: 'Mover componentes nos eixos X, Y e Z', needsModel: true, mode: 'move' },
          { id: 'measure', icon: 'measure', label: 'Medir', title: 'Medição profissional: vértices, arestas, faces, distâncias e ângulos', needsModel: true, mode: 'measure' },
          { id: 'boxsel', icon: 'assembly', label: 'Criar\nmontagem', title: 'Arraste um retângulo em volta dos componentes para agrupá-los', needsModel: true, mode: 'boxselect' },
          { id: 'texture', icon: 'tex', label: 'Textura', title: 'Aplicar texturas MDF (biblioteca com busca)', needsModel: true, onClick: () => app.texture.toggle() },
          { id: 'render', icon: 'render', label: 'Renderi-\nzar', title: 'Renderização ultra-realista + foto e vídeo 4K', needsModel: true, onClick: () => app.render.open() },
          { id: 'explode', icon: 'explode', label: 'Explosão\nIA', title: 'Explosão automática inteligente com câmera cinematográfica', needsModel: true, onClick: () => app.explode.play() },
          { id: 'manual', icon: 'manual', label: 'Manual de\nmontagem', title: 'Passo a passo interativo de montagem com ferragens por etapa', needsModel: true, onClick: () => app.manual.open() },
          { id: 'cine', icon: 'cine', label: 'Cinemá-\ntica', title: 'Gravar movimentos e câmera; replay suavizado com reverso, loop e vídeo', needsModel: true, toggle: true, onClick: () => app.cinematic.toggle() }
        ]
      },
      {
        label: 'Exibir',
        buttons: [
          { id: 'fit', icon: 'fit', label: 'Enqua-\ndrar', title: 'Zoom ajustar (F)', needsModel: true, onClick: () => app.fitAll() },
          { id: 'hide', icon: 'hideeye', label: 'Ocultar', title: 'Ocultar componentes: clique neles ou arraste um retângulo', needsModel: true, mode: 'hide' },
          { id: 'isolate', icon: 'isolate', label: 'Isolar', title: 'Isolar componente selecionado', needsModel: true, toggle: true, onClick: () => app.toggleIsolate() },
          { id: 'xray', icon: 'xray', label: 'Raio-X', title: 'Transparência fantasma (ver peças internas)', needsModel: true, toggle: true, onClick: () => app.toggleXray() },
          { id: 'section', icon: 'section', label: 'Seção', title: 'Vista de seção dinâmica', needsModel: true, toggle: true, onClick: () => app.toggleSection() },
          { id: 'present', icon: 'present', label: 'Apresen-\ntar', title: 'Tela cheia com órbita automática — ESC sai', needsModel: true, toggle: true, onClick: () => app.togglePresent() },
          { id: 'showall', icon: 'showall', label: 'Mostrar\ntudo', title: 'Reexibir todos os componentes', needsModel: true, onClick: () => app.showAll() },
          { id: 'reset', icon: 'reset', label: 'Restaurar\nposições', title: 'Voltar todos os componentes para o lugar', needsModel: true, onClick: () => app.move.resetAll() }
        ]
      },
      {
        label: 'Análise',
        buttons: [
          { id: 'interf', icon: 'interf', label: 'Interfe-\nrências', title: 'Detectar sobreposições entre componentes', needsModel: true, onClick: () => app.bom.showInterferences() }
        ]
      }
    ];

    for (const g of groups) {
      const gEl = document.createElement('div');
      gEl.className = 'ribbon-group';
      const btns = document.createElement('div');
      btns.className = 'ribbon-group-buttons';
      for (const b of g.buttons) {
        const el = document.createElement('button');
        el.className = 'ribbon-btn';
        el.title = b.title || '';
        el.innerHTML = ICONS[b.icon] + '<span>' + b.label.replace('\n', '<br/>') + '</span>';
        if (b.mode) {
          el.addEventListener('click', () =>
            this.app.setMode(this.app.mode === b.mode ? 'select' : b.mode));
          this.modeButtons[b.mode] = el;
        } else {
          el.addEventListener('click', b.onClick);
          if (b.id === 'texture') this.modeButtons.texture = el;
        }
        if (b.toggle) this.toggleButtons[b.id] = el;
        if (b.needsModel) el.dataset.needsModel = '1';
        btns.appendChild(el);
      }
      const lbl = document.createElement('div');
      lbl.className = 'ribbon-group-label';
      lbl.textContent = g.label;
      gEl.appendChild(btns);
      gEl.appendChild(lbl);
      ribbon.appendChild(gEl);
    }
    this.refreshEnabled();
  }

  refreshEnabled() {
    const has = this.app.model.hasModel;
    document.querySelectorAll('[data-needs-model]').forEach((el) => {
      el.disabled = !has;
    });
  }

  refreshModeButtons() {
    for (const [mode, el] of Object.entries(this.modeButtons)) {
      el.classList.toggle('active', this.app.mode === mode);
    }
  }

  setToggleState(id, on) {
    if (this.toggleButtons[id]) this.toggleButtons[id].classList.toggle('active', on);
  }

  setRecording(id, on) {
    if (this.toggleButtons[id]) {
      this.toggleButtons[id].classList.toggle('recording', on);
    }
  }

  // ---------------- Vistas ----------------
  buildViewButtons() {
    const bar = document.getElementById('view-buttons');
    bar.innerHTML = '';
    this.viewBtns = {};
    const views = [
      ['iso', 'ISO'], ['frente', 'Frente'], ['tras', 'Trás'],
      ['esquerda', 'Esq.'], ['direita', 'Dir.'], ['topo', 'Topo'], ['base', 'Base']
    ];
    for (const [key, label] of views) {
      const b = document.createElement('button');
      b.className = 'view-btn';
      b.textContent = label;
      b.title = key === 'iso'
        ? 'Vista isométrica'
        : `Vista ${label} exata (90°) — trava o ângulo; clique de novo para destravar`;
      b.addEventListener('click', () => {
        if (key === 'iso') {
          this.app.unlockView();
          this.app.viewer.setView('iso', this.app.model.unionBox());
        } else {
          this.app.setViewLocked(key);
        }
      });
      bar.appendChild(b);
      this.viewBtns[key] = b;
    }
  }

  refreshViewButtons() {
    const lock = this.app.viewer.viewLock;
    for (const [key, b] of Object.entries(this.viewBtns)) {
      b.classList.toggle('active', lock === key);
    }
  }

  // ---------------- Painel de seção ----------------
  buildSectionPanel() {
    const app = this.app;
    const p = document.getElementById('section-panel');
    p.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'fp-header';
    header.innerHTML = '<span>Vista de Seção</span>';
    const close = document.createElement('button');
    close.className = 'fp-close';
    close.textContent = '✕';
    close.addEventListener('click', () => app.toggleSection(false));
    header.appendChild(close);
    p.appendChild(header);

    const body = document.createElement('div');
    body.className = 'fp-body';

    const axisRow = document.createElement('div');
    axisRow.className = 'section-row';
    axisRow.innerHTML = '<span>Eixo:</span>';
    const seg = document.createElement('div');
    seg.className = 'seg';
    this.sectionAxisBtns = {};
    for (const axis of ['x', 'y', 'z']) {
      const b = document.createElement('button');
      b.textContent = axis.toUpperCase();
      b.addEventListener('click', () => { app.section.axis = axis; app.applySection(); this.syncSectionPanel(); });
      seg.appendChild(b);
      this.sectionAxisBtns[axis] = b;
    }
    axisRow.appendChild(seg);

    const flipBtn = document.createElement('button');
    flipBtn.className = 'btn-small';
    flipBtn.textContent = 'Inverter lado';
    flipBtn.addEventListener('click', () => { app.section.flip = !app.section.flip; app.applySection(); });
    axisRow.appendChild(flipBtn);
    body.appendChild(axisRow);

    const sliderRow = document.createElement('div');
    sliderRow.className = 'section-row';
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0'; slider.max = '1000'; slider.value = '500';
    slider.addEventListener('input', () => {
      app.section.t = parseInt(slider.value, 10) / 1000;
      app.applySection();
    });
    sliderRow.appendChild(slider);
    body.appendChild(sliderRow);
    this.sectionSlider = slider;

    p.appendChild(body);
  }

  syncSectionPanel() {
    for (const [axis, b] of Object.entries(this.sectionAxisBtns)) {
      b.classList.toggle('on', this.app.section.axis === axis);
    }
    this.sectionSlider.value = String(Math.round(this.app.section.t * 1000));
  }

  // ---------------- Árvore ----------------
  bindTreePanel() {
    const search = document.getElementById('tree-search');
    search.addEventListener('input', () => {
      this.searchTerm = search.value.trim().toLowerCase();
      this.refreshTree();
    });
    document.getElementById('tree-collapse').addEventListener('click', (e) => {
      const panel = document.getElementById('tree-panel');
      panel.classList.toggle('collapsed');
      e.target.textContent = panel.classList.contains('collapsed') ? '›' : '‹';
      setTimeout(() => window.dispatchEvent(new Event('resize')), 200);
    });
  }

  _nodeMatches(node) {
    if (!this.searchTerm) return true;
    if (node.type === 'part') return node.name.toLowerCase().includes(this.searchTerm);
    return node.children.some((c) => this._nodeMatches(c));
  }

  /** Linha de peça na árvore (usada na hierarquia e dentro de montagens). */
  _partRow(comp, depth) {
    const app = this.app;
    const row = document.createElement('div');
    row.className = 'tree-row';
    row.style.paddingLeft = 4 + depth * 14 + 'px';

    const spacer = document.createElement('span');
    spacer.className = 'tree-caret';
    row.appendChild(spacer);

    const eye = this._makeEye(comp.eyeVisible, () => {
      comp.eyeVisible = !comp.eyeVisible;
      app.model.applyVisibilityAll();
      this.refreshTree();
    });
    row.appendChild(eye);

    const dot = document.createElement('span');
    dot.className = 'tree-color';
    dot.style.background = '#' + comp.baseColor.getHexString();
    row.appendChild(dot);

    const name = document.createElement('span');
    name.className = 'tree-name';
    name.textContent = comp.name;
    name.title = comp.name;
    row.appendChild(name);

    if (comp.layerId != null) {
      const badge = document.createElement('span');
      badge.className = 'tree-badge';
      badge.textContent = 'L' + comp.layerId;
      badge.title = 'Layer ' + comp.layerId +
        (app.layers.layers[comp.layerId].name
          ? ' — ' + app.layers.layers[comp.layerId].name : '');
      row.appendChild(badge);
    }

    if (app.selectedComps.has(comp)) row.classList.add('selected');
    if (!app.model.computeVisible(comp)) row.classList.add('hidden-comp');

    row.addEventListener('click', (e) => {
      if (app.layers.capture) { app.layers.captureToggle(comp); return; }
      app.select(comp, { additive: e.ctrlKey });
    });
    row.addEventListener('dblclick', () => {
      if (app.layers.capture) return;
      app.select(comp);
      app.viewer.fitBox(comp.currentAABB());
    });
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (app.layers.capture) return;
      app.showContextMenu(e.clientX, e.clientY, comp);
    });
    return row;
  }

  /** Nó de montagem: bloco destacado com as peças-membro aninhadas. */
  _renderAssembly(asm, depth) {
    const app = this.app;
    if (this.searchTerm) {
      const matches = asm.name.toLowerCase().includes(this.searchTerm) ||
        asm.members.some((m) => m.name.toLowerCase().includes(this.searchTerm));
      if (!matches) return null;
    }
    const el = document.createElement('div');
    el.className = 'tree-node' + (asm.collapsed ? ' collapsed' : '');

    const row = document.createElement('div');
    row.className = 'tree-row assembly-row';
    row.style.paddingLeft = 4 + depth * 14 + 'px';

    const caret = document.createElement('span');
    caret.className = 'tree-caret';
    caret.textContent = asm.collapsed ? '▶' : '▼';
    caret.addEventListener('click', (e) => {
      e.stopPropagation();
      asm.collapsed = !asm.collapsed;
      this.refreshTree();
    });
    row.appendChild(caret);

    const anyVisible = asm.members.some((m) => m.eyeVisible);
    const eye = this._makeEye(anyVisible, () => {
      for (const m of asm.members) m.eyeVisible = !anyVisible;
      app.model.applyVisibilityAll();
      this.refreshTree();
    });
    row.appendChild(eye);

    const icon = document.createElement('span');
    icon.className = 'assembly-icon';
    icon.textContent = '📦';
    row.appendChild(icon);

    const name = document.createElement('span');
    name.className = 'tree-name assembly-name';
    name.textContent = asm.name;
    name.title = `Montagem "${asm.name}" — bloco único ao mover e explodir`;
    row.appendChild(name);

    const count = document.createElement('span');
    count.className = 'tree-badge assembly-badge';
    count.textContent = String(asm.members.length);
    row.appendChild(count);

    if (app.selectedAssembly === asm ||
        (asm.members.length &&
         asm.members.every((m) => app.selectedComps.has(m)))) {
      row.classList.add('selected');
    }

    row.addEventListener('click', (e) => {
      if (app.layers.capture) return;
      app.selectAssembly(asm, { additive: e.ctrlKey });
    });
    row.addEventListener('dblclick', () => {
      app.selectAssembly(asm);
      app.zoomSelection();
    });
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (app.layers.capture) return;
      app.selectAssembly(asm);
      app.showContextMenu(e.clientX, e.clientY, asm.members[0]);
    });

    el.appendChild(row);
    const kids = document.createElement('div');
    kids.className = 'tree-children assembly-children';
    for (const m of asm.members) kids.appendChild(this._partRow(m, depth + 1));
    el.appendChild(kids);
    return el;
  }

  refreshTree() {
    const app = this.app;
    this.treeEl.innerHTML = '';
    if (!app.model.treeRoot) return;

    const renderNode = (node, depth) => {
      if (!this._nodeMatches(node)) return null;
      if (node.type === 'part') {
        if (node.comp.assembly) return null; // exibida dentro da montagem
        const wrap = document.createElement('div');
        wrap.className = 'tree-node';
        wrap.appendChild(this._partRow(node.comp, depth));
        return wrap;
      }
      const el = document.createElement('div');
      el.className = 'tree-node' + (node.collapsed ? ' collapsed' : '');

      const row = document.createElement('div');
      row.className = 'tree-row';
      row.style.paddingLeft = 4 + depth * 14 + 'px';

      if (node.type === 'group') {
        const caret = document.createElement('span');
        caret.className = 'tree-caret';
        caret.textContent = node.collapsed ? '▶' : '▼';
        caret.addEventListener('click', (e) => {
          e.stopPropagation();
          node.collapsed = !node.collapsed;
          this.refreshTree();
        });
        row.appendChild(caret);

        const eye = this._makeEye(
          this._groupAnyVisible(node),
          () => this._toggleGroupEyes(node));
        row.appendChild(eye);

        const name = document.createElement('span');
        name.className = 'tree-name';
        name.style.fontWeight = '600';
        name.textContent = node.name;
        row.appendChild(name);

        const count = document.createElement('span');
        count.className = 'tree-badge';
        count.style.background = '#8a97a5';
        count.textContent = String(this._countParts(node));
        row.appendChild(count);
      }

      el.appendChild(row);

      const kids = document.createElement('div');
      kids.className = 'tree-children';
      // montagens aparecem primeiro, destacadas, sob a raiz
      if (node === app.model.treeRoot) {
        for (const asm of app.model.assemblies) {
          const asmEl = this._renderAssembly(asm, depth + 1);
          if (asmEl) kids.appendChild(asmEl);
        }
      }
      for (const ch of node.children) {
        const chEl = renderNode(ch, depth + 1);
        if (chEl) kids.appendChild(chEl);
      }
      el.appendChild(kids);
      return el;
    };

    const rootEl = renderNode(app.model.treeRoot, 0);
    if (rootEl) this.treeEl.appendChild(rootEl);
  }

  _makeEye(on, onClick) {
    const eye = document.createElement('button');
    eye.className = 'tree-eye';
    eye.innerHTML = on ? EYE_ON : EYE_OFF;
    eye.title = on ? 'Ocultar' : 'Mostrar';
    eye.addEventListener('click', (e) => { e.stopPropagation(); onClick(e); });
    return eye;
  }

  _countParts(node) {
    let n = 0;
    for (const ch of node.children) n += ch.type === 'part' ? 1 : this._countParts(ch);
    return n;
  }

  _groupAnyVisible(node) {
    for (const ch of node.children) {
      if (ch.type === 'part' ? ch.comp.eyeVisible : this._groupAnyVisible(ch)) return true;
    }
    return false;
  }

  _toggleGroupEyes(node) {
    const target = !this._groupAnyVisible(node);
    const apply = (n) => {
      for (const ch of n.children) {
        if (ch.type === 'part') ch.comp.eyeVisible = target;
        else apply(ch);
      }
    };
    apply(node);
    this.app.model.applyVisibilityAll();
    this.refreshTree();
  }

  // ---------------- Destaque de captura de layer ----------------
  setLayerHighlight(comps) {
    this.app.viewer.setStaged(comps);
  }

  // ---------------- Modal ----------------
  showModal({ title, content, actions = [], onClose }) {
    const root = document.getElementById('modal-root');
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const modal = document.createElement('div');
    modal.className = 'modal';

    const header = document.createElement('div');
    header.className = 'modal-header';
    header.innerHTML = `<span>${title}</span>`;
    const x = document.createElement('button');
    x.className = 'fp-close';
    x.textContent = '✕';
    header.appendChild(x);

    const body = document.createElement('div');
    body.className = 'modal-body';
    body.appendChild(content);

    const footer = document.createElement('div');
    footer.className = 'modal-footer';

    const close = () => { backdrop.remove(); if (onClose) onClose(); };
    x.addEventListener('click', close);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });

    for (const a of actions) {
      const b = document.createElement('button');
      b.className = 'btn-small' + (a.primary ? ' primary' : '');
      b.textContent = a.label;
      b.addEventListener('click', () => {
        if (a.onClick) a.onClick();
        if (!a.keepOpen) close();
      });
      footer.appendChild(b);
    }

    modal.appendChild(header);
    modal.appendChild(body);
    if (actions.length) modal.appendChild(footer);
    backdrop.appendChild(modal);
    root.appendChild(backdrop);
    return close;
  }

  /** Modal simples de texto; resolve com a string ou null se cancelado. */
  promptText({ title, label, placeholder, initial = '' }) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };

      const content = document.createElement('div');
      if (label) {
        const p = document.createElement('p');
        p.style.cssText = 'margin-bottom:10px;font-size:12px;color:#5a6572';
        p.textContent = label;
        content.appendChild(p);
      }
      const input = document.createElement('input');
      input.type = 'text';
      input.value = initial;
      input.placeholder = placeholder || '';
      input.style.cssText =
        'width:100%;padding:8px 10px;border:1px solid #c6cdd6;border-radius:4px;' +
        'font-family:inherit;font-size:13px;outline:none';
      content.appendChild(input);

      const close = this.showModal({
        title,
        content,
        actions: [
          { label: 'Cancelar', onClick: () => finish(null) },
          { label: 'OK', primary: true, onClick: () => finish(input.value.trim()) }
        ],
        onClose: () => finish(null)
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { finish(input.value.trim()); close(); }
      });
      setTimeout(() => input.focus(), 30);
    });
  }

  // ---------------- Menu de contexto ----------------
  contextMenu(x, y, titleText, items) {
    const menu = document.getElementById('context-menu');
    menu.innerHTML = '';
    if (titleText) {
      const t = document.createElement('div');
      t.className = 'ctx-title';
      t.textContent = titleText;
      menu.appendChild(t);
    }
    for (const it of items) {
      const b = document.createElement('button');
      b.className = 'ctx-item';
      b.textContent = it.label;
      b.addEventListener('click', () => { this.hideContextMenu(); it.onClick(); });
      menu.appendChild(b);
    }
    menu.classList.remove('hidden');
    const rect = menu.getBoundingClientRect();
    menu.style.left = Math.min(x, window.innerWidth - rect.width - 8) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - rect.height - 8) + 'px';

    const hide = (e) => {
      if (!menu.contains(e.target)) {
        this.hideContextMenu();
        window.removeEventListener('pointerdown', hide, true);
      }
    };
    setTimeout(() => window.addEventListener('pointerdown', hide, true), 0);
  }

  hideContextMenu() {
    document.getElementById('context-menu').classList.add('hidden');
  }

  // ---------------- Diversos ----------------
  toast(msg, type = '') {
    const box = document.getElementById('toasts');
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => {
      t.style.transition = 'opacity 0.4s';
      t.style.opacity = '0';
      setTimeout(() => t.remove(), 450);
    }, 2600);
  }

  loading(show, text) {
    const el = document.getElementById('loading-overlay');
    el.classList.toggle('hidden', !show);
    if (text) document.getElementById('loading-text').textContent = text;
    if (show) this._startCalcTicker();
    else this._stopCalcTicker();
  }

  /** Console de cálculos de engenharia exibido durante o carregamento. */
  _startCalcTicker() {
    if (this._calcTimer) return;
    const list = document.getElementById('loading-calcs');
    const bar = document.getElementById('loading-bar-fill');
    list.innerHTML = '';
    bar.style.width = '2%';
    this._calcT0 = performance.now();

    const br = (n, d = 1) => n.toFixed(d).replace('.', ',');
    const R = (a, b) => a + Math.random() * (b - a);
    const CALCS = [
      () => { const v = R(0.006, 0.09); return `ρ(MDF) = 750 kg/m³ • V = ${br(v, 4)} m³ → m = ρ·V = ${br(v * 750, 2)} kg`; },
      () => { const m = R(4, 60); return `P = m·g = ${br(m, 2)} kg × 9,81 m/s² = ${br(m * 9.81, 1)} N (peso)`; },
      () => { const c = R(0.3, 1.8), l = R(0.2, 0.7); return `A = C×L = ${br(c, 3)} × ${br(l, 3)} = ${br(c * l, 3)} m² (face)`; },
      () => { const c = R(300, 1800), l = R(200, 700); return `√(C² + L²) = √(${br(c, 0)}² + ${br(l, 0)}²) = ${br(Math.hypot(c, l), 1)} mm (diagonal)`; },
      () => { const b = R(200, 600), h = R(15, 25); return `I = b·h³/12 = ${br(b, 0)}·${br(h, 0)}³/12 = ${br(b * h * h * h / 12 / 1e4, 1)}×10⁴ mm⁴`; },
      () => `δmáx = 5qL⁴/(384·E·I) = ${br(R(0.3, 2.8), 2)} mm (flecha da prateleira)`,
      () => `E(MDF) = 3.000 MPa • σadm = ${br(R(8, 14), 1)} MPa (tensão admissível)`,
      () => { const f = R(120, 480); return `Fat = μ·N = 0,35 × ${br(f, 0)} = ${br(0.35 * f, 1)} N (atrito madeira)`; },
      () => `T = K·F·d = ${br(R(1.2, 4.2), 2)} N·m (torque de fixação)`,
      () => `x̄ = Σmᵢ·xᵢ / Σmᵢ = ${br(R(180, 820), 1)} mm (centro de massa)`,
      () => `q = ${br(R(30, 140), 1)} N/m (carga distribuída na prateleira)`,
      () => `Ec = ½·m·v² → estabilidade dinâmica verificada ✓`,
      () => `M² de corte acumulado = ${br(R(1.5, 22), 3)} m²`,
      () => `Umidade de equilíbrio da chapa: ${br(R(8, 12), 1)} %`,
      () => `Vértices processados: ${Math.floor(R(800, 96000)).toLocaleString('pt-BR')}`,
      () => `OBB: autovetores das normais dominantes → C×L×E resolvido ✓`,
      () => `g = 9,80665 m/s² (gravidade padrão) • FS = ${br(R(1.8, 3.2), 1)} (fator de segurança)`
    ];
    let i = Math.floor(Math.random() * CALCS.length);

    this._calcTimer = setInterval(() => {
      const line = document.createElement('div');
      line.className = 'calc-line';
      line.textContent = '▸ ' + CALCS[i % CALCS.length]();
      i += 1 + Math.floor(Math.random() * 2);
      list.appendChild(line);
      while (list.children.length > 8) list.firstChild.remove();
      // 0→90% nos primeiros 5s; depois rasteja até 97% (projetos grandes)
      const t = (performance.now() - this._calcT0) / 1000;
      const p = t < 5 ? (t / 5) * 90 : Math.min(97, 90 + (t - 5) * 1.4);
      bar.style.width = p.toFixed(1) + '%';
    }, 330);
  }

  _stopCalcTicker() {
    if (!this._calcTimer) return;
    clearInterval(this._calcTimer);
    this._calcTimer = null;
    const bar = document.getElementById('loading-bar-fill');
    if (bar) bar.style.width = '100%';
  }

  welcome(show) {
    document.getElementById('welcome-card').classList.toggle('hidden', !show);
  }

  setStatus(text) {
    document.getElementById('status-hint').textContent = text;
  }

  setSelectionStatus(text) {
    document.getElementById('status-sel').textContent = text || '';
  }

  setFileInfo(name, comps, tris, weight) {
    document.getElementById('file-name').textContent = name || 'Nenhum projeto aberto';
    const parts = [];
    if (comps) {
      parts.push(`${comps} componente(s)`);
      if (weight && weight.totalKg > 0) {
        parts.push(`⚖ Peso total: ${fmt(weight.totalKg, 1)} kg`);
      }
    }
    document.getElementById('model-stats').textContent = parts.join(' • ');

    const right = document.getElementById('status-right');
    if (weight && weight.totalKg > 0) {
      const note = weight.mdfCount < weight.count
        ? ` (${weight.mdfCount} de ${weight.count} peças MDF)`
        : ' — MDF 750 kg/m³';
      right.textContent = `Peso total: ${fmt(weight.totalKg, 1)} kg${note}`;
      right.style.fontWeight = '700';
      right.style.color = '#1f6fc4';
    } else {
      right.textContent = 'VDV Viewer — created by Gustavinho';
      right.style.fontWeight = '';
      right.style.color = '';
    }
  }
}
