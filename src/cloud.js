// Explorador de projetos na nuvem — estilo Windows Explorer:
// pastas, salvar/abrir projetos, data/hora/usuário e link compartilhável.
import {
  listChildren, createFolder, deleteFolder, deleteProject,
  saveProject, getProjectBySlug, downloadProjectFile, shareUrl
} from './supabase.js';
import { fmt } from './utils.js';

const FOLDER_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v2H3z" fill="#f4c563" stroke="#c78f2d" stroke-width="1"/><path d="M3 8v10a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V8" fill="#fbd989" stroke="#c78f2d" stroke-width="1"/></svg>';
const PROJ_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 3 4 7.5v9L12 21l8-4.5v-9L12 3z" fill="#dcebfa" stroke="#1f6fc4" stroke-width="1.3"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9" fill="none" stroke="#1f6fc4" stroke-width="1.3"/></svg>';

export class CloudExplorer {
  constructor(app) {
    this.app = app;
    this.mode = 'open';
    this.path = [{ id: null, name: 'Início' }];
    this.el = null;
  }

  get currentFolderId() {
    return this.path[this.path.length - 1].id;
  }

  open(mode) {
    this.mode = mode;
    if (mode === 'save' && !this.app.lastBuffer) {
      this.app.ui.toast('Abra um projeto STEP antes de salvar na nuvem.', 'warn');
      return;
    }
    this._build();
    this._load();
  }

  close() {
    if (this.el) { this.el.remove(); this.el = null; }
  }

  // ---------------- Fluxos ----------------
  async openBySlug(slug) {
    try {
      this.app.ui.loading(true, 'Localizando projeto compartilhado…');
      const row = await getProjectBySlug(slug);
      if (!row) {
        this.app.ui.loading(false);
        this.app.ui.toast('Projeto não encontrado — o link pode ter sido removido.', 'error');
        return;
      }
      await this.openProject(row);
    } catch (err) {
      this.app.ui.loading(false);
      this.app.ui.toast('Erro ao abrir o link: ' + err.message, 'error');
    }
  }

  async openProject(row) {
    try {
      this.close();
      this.app.ui.loading(true, `Baixando "${row.name}" da nuvem…`);
      // a listagem do explorador é resumida (sem file_path/state):
      // busca a linha completa e mais recente antes de abrir
      if (!row.file_path || row.state === undefined) {
        const full = await getProjectBySlug(row.slug);
        if (!full) throw new Error('Projeto não encontrado na nuvem.');
        row = full;
      }
      const buffer = await downloadProjectFile(row, (i, n) => {
        if (n > 1) {
          this.app.ui.loading(true, `Baixando "${row.name}" — parte ${i}/${n}…`);
        }
      });
      await this.app._loadBuffer(buffer, row.file_name || row.name + '.step');
      this.app.applyCloudState(row.state || {});
      this.app.setCloudSlug(row.slug);
      this.app.ui.setStatus(
        `☁ "${row.name}" — salvo por ${row.saved_by} em ${fmtDate(row.updated_at)}`);
      this.app.ui.toast(`Projeto "${row.name}" carregado da nuvem.`, 'success');
    } catch (err) {
      this.app.ui.loading(false);
      this.app.ui.toast('Erro ao abrir projeto: ' + err.message, 'error');
    }
  }

  async _saveHere() {
    const name = (this._nameInput.value || '').trim();
    if (!name) {
      this.app.ui.toast('Dê um nome ao projeto.', 'warn');
      this._nameInput.focus();
      return;
    }
    const btn = this._saveBtn;
    btn.disabled = true;
    btn.textContent = 'Salvando…';
    try {
      const row = await saveProject({
        name,
        folderId: this.currentFolderId,
        fileName: this.app.lastFileName || name + '.step',
        buffer: this.app.lastBuffer,
        state: this.app.captureCloudState(),
        username: this.app.auth.user ? this.app.auth.user.display_name : '?',
        onProgress: (i, n) => {
          btn.textContent = n > 1 ? `Enviando ${i}/${n}…` : 'Salvando…';
        }
      });
      this.app.setCloudSlug(row.slug);
      const url = shareUrl(row.slug);
      try { await navigator.clipboard.writeText(url); } catch (_) { /* sem permissão */ }
      this.app.ui.toast(
        `☁ "${name}" salvo na nuvem! Link copiado: ${url}`, 'success');
      this.close();
    } catch (err) {
      this.app.ui.toast('Erro ao salvar: ' + err.message, 'error');
      btn.disabled = false;
      btn.textContent = '💾 Salvar aqui';
    }
  }

  async _newFolder() {
    const name = await this.app.ui.promptText({
      title: '📁 Nova pasta',
      label: 'Nome da pasta:',
      placeholder: 'ex.: Cozinhas, Cliente João, 2026…'
    });
    if (!name) return;
    try {
      await createFolder(name, this.currentFolderId,
        this.app.auth.user ? this.app.auth.user.display_name : '?');
      this._load();
    } catch (err) {
      this.app.ui.toast('Erro ao criar pasta: ' + err.message, 'error');
    }
  }

  // ---------------- UI ----------------
  _build() {
    this.close();
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) this.close();
    });

    const modal = document.createElement('div');
    modal.className = 'modal cloud-modal';
    modal.innerHTML = `
      <div class="modal-header">
        <span>${this.mode === 'save' ? '☁ Salvar projeto na nuvem' : '☁ Projetos na nuvem'}</span>
        <button class="fp-close" data-act="close">✕</button>
      </div>
      <div class="cloud-toolbar">
        <div class="cloud-crumbs" data-role="crumbs"></div>
        <div class="cloud-actions">
          <button class="btn-small" data-act="newfolder">📁 Nova pasta</button>
          <button class="btn-small" data-act="refresh">⟳</button>
        </div>
      </div>
      ${this.mode === 'save' ? `
      <div class="cloud-savebar">
        <input type="text" data-role="name" placeholder="Nome do projeto…"
          value="${(this.app.lastFileName || '').replace(/\.(step|stp)$/i, '').replace(/"/g, '&quot;')}" />
        <button class="btn-small primary" data-act="save">💾 Salvar aqui</button>
      </div>` : ''}
      <div class="cloud-list" data-role="list">
        <div class="cloud-loading"><div class="spinner"></div></div>
      </div>
      <div class="cloud-foot">
        ${this.mode === 'save'
          ? 'Navegue até a pasta desejada e clique em Salvar aqui.'
          : 'Duplo clique abre • Botão direito: link de compartilhamento e excluir.'}
      </div>`;

    backdrop.appendChild(modal);
    document.getElementById('modal-root').appendChild(backdrop);
    this.el = backdrop;

    modal.querySelector('[data-act="close"]').addEventListener('click', () => this.close());
    modal.querySelector('[data-act="newfolder"]').addEventListener('click', () => this._newFolder());
    modal.querySelector('[data-act="refresh"]').addEventListener('click', () => this._load());
    this._listEl = modal.querySelector('[data-role="list"]');
    this._crumbsEl = modal.querySelector('[data-role="crumbs"]');
    if (this.mode === 'save') {
      this._nameInput = modal.querySelector('[data-role="name"]');
      this._saveBtn = modal.querySelector('[data-act="save"]');
      this._saveBtn.addEventListener('click', () => this._saveHere());
      this._nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this._saveHere();
      });
    }
    this._renderCrumbs();
  }

  _renderCrumbs() {
    this._crumbsEl.innerHTML = '';
    this.path.forEach((p, i) => {
      if (i > 0) {
        const sep = document.createElement('span');
        sep.className = 'crumb-sep';
        sep.textContent = '›';
        this._crumbsEl.appendChild(sep);
      }
      const b = document.createElement('button');
      b.className = 'crumb' + (i === this.path.length - 1 ? ' current' : '');
      b.textContent = i === 0 ? '🏠 Início' : p.name;
      b.addEventListener('click', () => {
        this.path = this.path.slice(0, i + 1);
        this._renderCrumbs();
        this._load();
      });
      this._crumbsEl.appendChild(b);
    });
  }

  async _load() {
    if (!this.el) return;
    this._listEl.innerHTML = '<div class="cloud-loading"><div class="spinner"></div></div>';
    try {
      const { folders, projects } = await listChildren(this.currentFolderId);
      this._renderList(folders, projects);
    } catch (err) {
      this._listEl.innerHTML =
        `<div class="cloud-empty">Erro ao carregar: ${err.message}</div>`;
    }
  }

  _renderList(folders, projects) {
    if (!this.el) return;
    this._listEl.innerHTML = '';

    const table = document.createElement('table');
    table.className = 'cloud-table';
    table.innerHTML =
      '<thead><tr><th style="width:46%">Nome</th><th>Salvo por</th>' +
      '<th>Data e hora</th><th>Tamanho</th></tr></thead>';
    const tbody = document.createElement('tbody');

    for (const f of folders) {
      const tr = document.createElement('tr');
      tr.className = 'cloud-row folder';
      tr.innerHTML =
        `<td>${FOLDER_ICON}<span>${esc(f.name)}</span></td>` +
        `<td>${esc(f.created_by || '—')}</td>` +
        `<td>${fmtDate(f.created_at)}</td><td>—</td>`;
      tr.addEventListener('dblclick', () => {
        this.path.push({ id: f.id, name: f.name });
        this._renderCrumbs();
        this._load();
      });
      tr.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.app.ui.contextMenu(e.clientX, e.clientY, '📁 ' + f.name, [
          { label: '📂 Abrir pasta', onClick: () => {
              this.path.push({ id: f.id, name: f.name });
              this._renderCrumbs();
              this._load();
            } },
          { label: '🗑 Excluir pasta', onClick: () => this._confirmDeleteFolder(f) }
        ]);
      });
      tbody.appendChild(tr);
    }

    for (const p of projects) {
      const tr = document.createElement('tr');
      tr.className = 'cloud-row project';
      tr.innerHTML =
        `<td>${PROJ_ICON}<span>${esc(p.name)}</span></td>` +
        `<td>👤 ${esc(p.saved_by || '—')}</td>` +
        `<td>${fmtDate(p.updated_at)}</td>` +
        `<td>${fmt(p.size_bytes / 1024, 0)} KB</td>`;
      tr.addEventListener('dblclick', () => {
        if (this.mode === 'save') this._nameInput.value = p.name;
        else this.openProject(p);
      });
      tr.addEventListener('click', () => {
        if (this.mode === 'save') this._nameInput.value = p.name;
      });
      tr.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.app.ui.contextMenu(e.clientX, e.clientY, p.name, [
          { label: '📂 Abrir projeto', onClick: () => this.openProject(p) },
          { label: '🔗 Copiar link de compartilhamento', onClick: async () => {
              try {
                await navigator.clipboard.writeText(shareUrl(p.slug));
                this.app.ui.toast('Link copiado: ' + shareUrl(p.slug), 'success');
              } catch (_) {
                this.app.ui.toast(shareUrl(p.slug));
              }
            } },
          { label: '🗑 Excluir projeto', onClick: () => this._confirmDeleteProject(p) }
        ]);
      });
      tbody.appendChild(tr);
    }

    table.appendChild(tbody);
    this._listEl.appendChild(table);

    if (!folders.length && !projects.length) {
      const empty = document.createElement('div');
      empty.className = 'cloud-empty';
      empty.textContent = this.mode === 'save'
        ? 'Pasta vazia — clique em "Salvar aqui" para gravar o projeto nesta pasta.'
        : 'Pasta vazia — salve projetos pelo botão "Salvar na nuvem".';
      this._listEl.appendChild(empty);
    }
  }

  _confirmDeleteFolder(f) {
    const content = document.createElement('p');
    content.textContent =
      `Excluir a pasta "${f.name}"? Subpastas serão excluídas junto; ` +
      'projetos dentro dela voltam para o Início.';
    this.app.ui.showModal({
      title: '🗑 Excluir pasta',
      content,
      actions: [
        { label: 'Cancelar' },
        { label: 'Excluir', primary: true, onClick: async () => {
            try { await deleteFolder(f.id); this._load(); }
            catch (err) { this.app.ui.toast('Erro: ' + err.message, 'error'); }
          } }
      ]
    });
  }

  _confirmDeleteProject(p) {
    const content = document.createElement('p');
    content.textContent =
      `Excluir o projeto "${p.name}" (salvo por ${p.saved_by})? ` +
      'O link de compartilhamento deixará de funcionar.';
    this.app.ui.showModal({
      title: '🗑 Excluir projeto',
      content,
      actions: [
        { label: 'Cancelar' },
        { label: 'Excluir', primary: true, onClick: async () => {
            try { await deleteProject(p); this._load(); }
            catch (err) { this.app.ui.toast('Erro: ' + err.message, 'error'); }
          } }
      ]
    });
  }
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}
