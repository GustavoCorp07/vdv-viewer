// Plano de Corte Automático (BOM inteligente) + Detecção de Interferências.
import * as THREE from 'three';
import { fmt, csvNum } from './utils.js';

export class BomTool {
  constructor(app) {
    this.app = app;
  }

  /** Agrupa peças idênticas por nome-base + dimensões (arredondadas a 0,1 mm). */
  buildRows() {
    const groups = new Map();
    for (const comp of this.app.model.components) {
      const d = comp.dims;
      const base = comp.baseName || comp.name;
      const key = `${base}|${d.c.toFixed(1)}|${d.l.toFixed(1)}|${d.e.toFixed(1)}`;
      if (!groups.has(key)) {
        groups.set(key, {
          name: base, c: d.c, l: d.l, e: d.e, m2: d.m2,
          material: comp.material ? `MDF ${comp.nominalThickness}` : '—',
          weight: comp.weightKg, qty: 0, comps: []
        });
      }
      const g = groups.get(key);
      g.qty++;
      g.comps.push(comp);
    }
    return [...groups.values()].sort((a, b) =>
      a.name.localeCompare(b.name, 'pt-BR') || b.c - a.c);
  }

  showCutList() {
    const rows = this.buildRows();
    if (!rows.length) return;

    const wrap = document.createElement('div');
    const table = document.createElement('table');
    table.className = 'data-table';
    table.innerHTML =
      '<thead><tr><th>Qtde</th><th>Peça</th><th>Comprimento (mm)</th>' +
      '<th>Largura (mm)</th><th>Espessura (mm)</th><th>Material</th>' +
      '<th>Peso unit. (kg)</th><th>M² unit.</th><th>M² total</th></tr></thead>';
    const tbody = document.createElement('tbody');
    let totalM2 = 0, totalQty = 0, totalKg = 0;
    for (const r of rows) {
      totalM2 += r.m2 * r.qty;
      totalQty += r.qty;
      if (r.weight != null) totalKg += r.weight * r.qty;
      const tr = document.createElement('tr');
      tr.className = 'clickable';
      tr.title = 'Clique para destacar no modelo';
      tr.innerHTML =
        `<td>${r.qty}</td><td>${r.name}</td><td>${fmt(r.c, 1)}</td>` +
        `<td>${fmt(r.l, 1)}</td><td>${fmt(r.e, 1)}</td><td>${r.material}</td>` +
        `<td>${r.weight != null ? fmt(r.weight, 2) : '—'}</td>` +
        `<td>${fmt(r.m2, 3)}</td><td>${fmt(r.m2 * r.qty, 3)}</td>`;
      tr.addEventListener('click', () => {
        this.app.select(r.comps[0]);
        const box = new THREE.Box3();
        const tmp = new THREE.Box3();
        for (const c of r.comps) box.union(c.currentAABB(tmp));
        this.app.viewer.fitBox(box);
      });
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);

    const totals = document.createElement('div');
    totals.className = 'table-totals';
    totals.textContent =
      `${totalQty} peça(s) em ${rows.length} item(ns) • Área total: ${fmt(totalM2, 3)} m² • ` +
      `Peso total: ${fmt(totalKg, 1)} kg (MDF 750 kg/m³)`;
    wrap.appendChild(totals);

    this.app.ui.showModal({
      title: '📋 Plano de Corte Automático',
      content: wrap,
      actions: [
        { label: 'Exportar CSV (Excel BR)', primary: true, onClick: () => this.exportCSV(rows) },
        { label: 'Fechar' }
      ]
    });
  }

  exportCSV(rows) {
    rows = rows || this.buildRows();
    const lines = ['Qtde;Peca;Comprimento_mm;Largura_mm;Espessura_mm;Material;' +
      'Peso_unit_kg;Peso_total_kg;M2_unitario;M2_total'];
    for (const r of rows) {
      lines.push([
        r.qty,
        '"' + r.name.replace(/"/g, '""') + '"',
        csvNum(r.c, 1), csvNum(r.l, 1), csvNum(r.e, 1),
        r.material,
        r.weight != null ? csvNum(r.weight, 2) : '',
        r.weight != null ? csvNum(r.weight * r.qty, 2) : '',
        csvNum(r.m2, 3), csvNum(r.m2 * r.qty, 3)
      ].join(';'));
    }
    // BOM UTF-8 p/ Excel abrir acentos corretamente
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const base = (this.app.model.fileName || 'projeto').replace(/\.(step|stp)$/i, '');
    a.download = `plano-de-corte-${base}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    this.app.ui.toast('Plano de corte exportado em CSV.', 'success');
  }

  // ---------------- Interferências ----------------
  findInterferences() {
    const comps = this.app.model.components;
    const results = [];
    const TOL = 0.15; // mm — ignora contatos de montagem
    for (let i = 0; i < comps.length; i++) {
      for (let j = i + 1; j < comps.length; j++) {
        const a = comps[i].aabb, b = comps[j].aabb;
        const ix = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x);
        const iy = Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y);
        const iz = Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z);
        if (ix > TOL && iy > TOL && iz > TOL) {
          results.push({ a: comps[i], b: comps[j], ix, iy, iz });
        }
      }
    }
    return results;
  }

  showInterferences() {
    const results = this.findInterferences();
    const wrap = document.createElement('div');

    if (!results.length) {
      wrap.innerHTML =
        '<p style="padding:6px 2px">✅ Nenhuma interferência detectada entre os ' +
        'componentes (posições originais do projeto).</p>';
    } else {
      const info = document.createElement('p');
      info.style.cssText = 'margin-bottom:10px;color:#5a6572;font-size:12px';
      info.textContent =
        `${results.length} sobreposição(ões) encontradas (análise por caixas envolventes, ` +
        'posições originais). Clique numa linha para destacar as peças.';
      wrap.appendChild(info);

      const table = document.createElement('table');
      table.className = 'data-table';
      table.innerHTML =
        '<thead><tr><th>Peça A</th><th>Peça B</th><th>Sobreposição (mm)</th></tr></thead>';
      const tbody = document.createElement('tbody');
      for (const r of results) {
        const tr = document.createElement('tr');
        tr.className = 'clickable';
        tr.innerHTML =
          `<td>${r.a.name}</td><td>${r.b.name}</td>` +
          `<td>${fmt(r.ix, 1)} × ${fmt(r.iy, 1)} × ${fmt(r.iz, 1)}</td>`;
        tr.addEventListener('click', () => {
          this.app.viewer.setDanger([r.a, r.b]);
          const box = r.a.aabb.clone().union(r.b.aabb);
          this.app.viewer.fitBox(box);
        });
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      wrap.appendChild(table);
    }

    this.app.ui.showModal({
      title: '⚠ Detecção de Interferências',
      content: wrap,
      actions: [{ label: 'Fechar', onClick: () => this.app.viewer.setDanger([]) }],
      onClose: () => this.app.viewer.setDanger([])
    });
  }
}
