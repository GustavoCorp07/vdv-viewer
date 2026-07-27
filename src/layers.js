// Sistema de Layers 0–20 (mecânica TopSolid Wood, botões invertidos a
// pedido do usuário):
//  - clique DIREITO no número → diálogo pede o nome; com o diálogo aberto,
//    clique ESQUERDO nos componentes da viewport adiciona/remove da layer;
//  - OK confirma; clique ESQUERDO no número ativa/desativa a layer;
//  - layer ativada = componentes visíveis; desativada = ocultos.

export const LAYER_COUNT = 21; // 0..20

export class LayerSystem {
  constructor(app) {
    this.app = app;
    this.layers = Array.from({ length: LAYER_COUNT }, (_, i) => ({
      id: i, name: '', active: true, members: new Set()
    }));
    this.capture = null; // { layer, staged:Set<Component>, prevName }
    this.barEl = document.getElementById('layers-bar');
    this.dialogEl = document.getElementById('layer-dialog');
    this.buildBar();
  }

  isVisible(comp) {
    if (comp.layerId == null) return true;
    return this.layers[comp.layerId].active;
  }

  reset() {
    for (const l of this.layers) { l.name = ''; l.active = true; l.members.clear(); }
    this.cancelCapture();
    this.refreshBar();
  }

  buildBar() {
    this.barEl.innerHTML = '';
    const title = document.createElement('span');
    title.className = 'layers-title';
    title.textContent = 'LAYERS';
    this.barEl.appendChild(title);

    this.chipEls = [];
    for (const layer of this.layers) {
      const chip = document.createElement('button');
      chip.className = 'layer-chip';
      chip.textContent = String(layer.id);
      chip.addEventListener('click', (e) => {
        e.preventDefault();
        this.toggleActive(layer.id);
      });
      chip.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.openEditor(layer.id);
      });
      this.barEl.appendChild(chip);
      this.chipEls.push(chip);
    }

    const legend = document.createElement('span');
    legend.className = 'layers-legend';
    legend.textContent =
      'Direito: editar layer (nome + peças)  •  Esquerdo: ativar/desativar (aceso = visível)';
    this.barEl.appendChild(legend);
    this.refreshBar();
  }

  refreshBar() {
    for (const layer of this.layers) {
      const chip = this.chipEls[layer.id];
      chip.classList.toggle('has-content', layer.members.size > 0 || !!layer.name);
      chip.classList.toggle('active-layer', layer.active);
      chip.classList.toggle('inactive-layer',
        !layer.active && (layer.members.size > 0 || !!layer.name));
      chip.classList.toggle('editing',
        !!this.capture && this.capture.layer === layer);
      chip.title = layer.name
        ? `Layer ${layer.id} — ${layer.name} (${layer.members.size} peça(s)) — ` +
          (layer.active ? 'ativada' : 'desativada')
        : `Layer ${layer.id} (vazia)`;
      const old = chip.querySelector('.layer-count');
      if (old) old.remove();
      if (layer.members.size > 0) {
        const badge = document.createElement('span');
        badge.className = 'layer-count';
        badge.textContent = String(layer.members.size);
        chip.appendChild(badge);
      }
    }
  }

  toggleActive(id) {
    const layer = this.layers[id];
    layer.active = !layer.active;
    this.refreshBar();
    this.app.model.applyVisibilityAll();
    this.app.ui.refreshTree();
    if (layer.members.size || layer.name) {
      this.app.ui.toast(
        `Layer ${id}${layer.name ? ' — ' + layer.name : ''}: ` +
        (layer.active ? 'ativada (visível)' : 'desativada (oculta)'),
        layer.active ? 'success' : 'warn');
    }
  }

  // ---------- Editor (captura por botão direito) ----------
  openEditor(id) {
    if (this.capture) this.cancelCapture();
    const layer = this.layers[id];
    this.capture = {
      layer,
      staged: new Set(layer.members),
      prevName: layer.name
    };
    this.app.setStatus(
      `Layer ${id} — clique com o botão ESQUERDO nos componentes para adicionar/remover • OK confirma`);
    this.renderDialog();
    this.refreshBar();
    this.app.ui.setLayerHighlight([...this.capture.staged]);
  }

  renderDialog() {
    const { layer, staged } = this.capture;
    const dlg = this.dialogEl;
    dlg.innerHTML = '';
    dlg.classList.remove('hidden');

    const header = document.createElement('div');
    header.className = 'ld-header';
    header.textContent = `Layer ${layer.id}`;
    dlg.appendChild(header);

    const body = document.createElement('div');
    body.className = 'ld-body';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Nome da layer (ex.: Portas, Fundos, Ferragens…)';
    input.value = layer.name;
    body.appendChild(input);
    this.captureInput = input;

    const hint = document.createElement('div');
    hint.className = 'ld-hint';
    hint.innerHTML =
      'Com esta janela aberta, clique com o <b>botão esquerdo</b> nos componentes ' +
      'do modelo 3D para adicioná-los (ou removê-los) desta layer.';
    body.appendChild(hint);

    const list = document.createElement('div');
    list.className = 'ld-members';
    this.membersListEl = list;
    body.appendChild(list);

    const actions = document.createElement('div');
    actions.className = 'ld-actions';
    const btnCancel = document.createElement('button');
    btnCancel.className = 'btn-small';
    btnCancel.textContent = 'Cancelar';
    btnCancel.addEventListener('click', () => this.cancelCapture());
    const btnOk = document.createElement('button');
    btnOk.className = 'btn-small primary';
    btnOk.textContent = 'OK';
    btnOk.addEventListener('click', () => this.commitCapture());
    actions.appendChild(btnCancel);
    actions.appendChild(btnOk);
    body.appendChild(actions);

    dlg.appendChild(body);
    this.renderMembers();
    setTimeout(() => input.focus(), 30);

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.commitCapture();
      if (e.key === 'Escape') this.cancelCapture();
    });
  }

  renderMembers() {
    const { staged } = this.capture;
    const list = this.membersListEl;
    list.innerHTML = '';
    if (!staged.size) {
      const empty = document.createElement('div');
      empty.className = 'ld-empty';
      empty.textContent = 'Nenhum componente nesta layer ainda.';
      list.appendChild(empty);
      return;
    }
    for (const comp of staged) {
      const row = document.createElement('div');
      row.className = 'ld-member';
      const name = document.createElement('span');
      name.textContent = comp.name;
      const rm = document.createElement('button');
      rm.textContent = '✕';
      rm.title = 'Remover da layer';
      rm.addEventListener('click', () => this.captureToggle(comp));
      row.appendChild(name);
      row.appendChild(rm);
      list.appendChild(row);
    }
  }

  /** Chamado pelo app quando o usuário clica com o direito num componente. */
  captureToggle(comp) {
    if (!this.capture) return false;
    const { staged } = this.capture;
    if (staged.has(comp)) {
      staged.delete(comp);
      this.app.ui.toast(`"${comp.name}" removido da layer ${this.capture.layer.id}`);
    } else {
      staged.add(comp);
      this.app.ui.toast(`"${comp.name}" adicionado à layer ${this.capture.layer.id}`, 'success');
    }
    this.renderMembers();
    this.app.ui.setLayerHighlight([...staged]);
    return true;
  }

  commitCapture() {
    if (!this.capture) return;
    const { layer, staged } = this.capture;
    layer.name = (this.captureInput.value || '').trim();

    // remove membros antigos que saíram
    for (const comp of layer.members) {
      if (!staged.has(comp)) comp.layerId = null;
    }
    // cada peça pertence a uma única layer: rouba de outras se preciso
    for (const comp of staged) {
      if (comp.layerId != null && comp.layerId !== layer.id) {
        this.layers[comp.layerId].members.delete(comp);
      }
      comp.layerId = layer.id;
    }
    layer.members = new Set(staged);

    this.capture = null;
    this.dialogEl.classList.add('hidden');
    this.app.ui.setLayerHighlight([]);
    this.refreshBar();
    this.app.model.applyVisibilityAll();
    this.app.ui.refreshTree();
    this.app.setStatusDefault();
    this.app.ui.toast(
      `Layer ${layer.id}${layer.name ? ' — ' + layer.name : ''} salva com ` +
      `${layer.members.size} peça(s)`, 'success');
  }

  cancelCapture() {
    if (!this.capture) return;
    this.capture = null;
    this.dialogEl.classList.add('hidden');
    this.app.ui.setLayerHighlight([]);
    this.refreshBar();
    this.app.setStatusDefault();
  }

  /** Remove componente de qualquer layer (usado ao limpar modelo). */
  detachAll() {
    for (const l of this.layers) l.members.clear();
  }
}
