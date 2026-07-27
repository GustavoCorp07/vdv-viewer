// Painel de propriedades do componente: nome, Comprimento, Largura,
// Espessura, M², volume, posição e layer — todas as medidas em mm.
import { fmtMM, fmtM2, fmt } from './utils.js';

export class PropertiesPanel {
  constructor(app) {
    this.app = app;
    this.el = document.getElementById('props-panel');
    this.comp = null;
  }

  showFor(comp) {
    this.comp = comp;
    const d = comp.dims;
    const pos = comp.group.position;
    const layer = comp.layerId != null ? this.app.layers.layers[comp.layerId] : null;

    this.el.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'fp-header';
    header.innerHTML = '<span>Propriedades</span>';
    const close = document.createElement('button');
    close.className = 'fp-close';
    close.textContent = '✕';
    close.addEventListener('click', () => this.hide());
    header.appendChild(close);
    this.el.appendChild(header);

    const body = document.createElement('div');
    body.className = 'fp-body';

    const title = document.createElement('div');
    title.className = 'prop-title';
    title.textContent = comp.name;
    body.appendChild(title);

    const rows = [
      ['Comprimento', fmtMM(d.c)],
      ['Largura', fmtMM(d.l)],
      ['Espessura', fmtMM(d.e)],
      ['Material', comp.material
        ? `<b style="color:#2c7a4b">MDF ${comp.nominalThickness} mm</b>`
        : 'Não classificado'],
      ['Peso', comp.weightKg != null ? fmt(comp.weightKg, 2) + ' kg' : '—'],
      ['Área (maior face)', fmtM2(d.m2)],
      ['Volume', fmt(d.volume, 3) + ' dm³'],
      ['Posição X', fmt(comp.center.x + pos.x, 1) + ' mm'],
      ['Posição Y', fmt(comp.center.y + pos.y, 1) + ' mm'],
      ['Posição Z', fmt(comp.center.z + pos.z, 1) + ' mm'],
      ['Layer', layer
        ? `${layer.id}${layer.name ? ' — ' + layer.name : ''}`
        : '—'],
      ['Cor', `<span class="prop-swatch" style="background:#${comp.baseColor.getHexString()}"></span> #${comp.baseColor.getHexString().toUpperCase()}`]
    ];
    for (const [k, v] of rows) {
      const row = document.createElement('div');
      row.className = 'prop-row';
      row.innerHTML = `<span class="k">${k}</span><span class="v">${v}</span>`;
      body.appendChild(row);
    }
    this.el.appendChild(body);
    this.el.classList.remove('hidden');
  }

  refresh() {
    if (this.comp && !this.el.classList.contains('hidden')) this.showFor(this.comp);
  }

  hide() {
    this.comp = null;
    this.el.classList.add('hidden');
  }
}
