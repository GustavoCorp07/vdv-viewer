// Tela de login corporativa do VDV Viewer — Supabase Auth completo.
// Usuários são criados manualmente pelo administrador (painel Authentication
// → Add user, ou `select vdv_admin_create_user('email','senha','Nome')`).
import { cloudLogin, cloudLogout, currentUser } from './supabase.js';

export class Auth {
  constructor(app) {
    this.app = app;
    this.el = document.getElementById('login-screen');
    this._user = null;
    this._build();
  }

  get user() { return this._user; }

  async init() {
    localStorage.removeItem('vdv-viewer-user'); // resquício do sistema antigo
    this.show(); // bloqueia até confirmar a sessão
    try {
      const user = await currentUser();
      if (user) {
        this._user = user;
        this.hide();
        this.app.onLoggedIn();
        return;
      }
    } catch (_) { /* sem sessão */ }
    setTimeout(() => this._userInput.focus(), 60);
  }

  show() { this.el.classList.remove('hidden'); }
  hide() { this.el.classList.add('hidden'); }

  async logout() {
    try { await cloudLogout(); } catch (_) { /* noop */ }
    this._user = null;
    this.app.onLoggedOut();
    this.show();
  }

  _build() {
    this.el.innerHTML = `
      <div class="login-card">
        <div class="login-logo">
          <img src="./logo.png" alt="VDV" class="login-logo-img" />
          <h1>VDV <b>Viewer</b></h1>
          <p class="login-credit">created by Gustavinho</p>
        </div>
        <p class="login-sub">Motor de engenharia Van de Velde</p>
        <form id="login-form" autocomplete="off">
          <label>E-mail</label>
          <input type="email" id="login-user" placeholder="seu e-mail" autocomplete="username" />
          <label>Senha</label>
          <input type="password" id="login-pass" placeholder="sua senha" autocomplete="current-password" />
          <div id="login-error" class="login-error hidden"></div>
          <button type="submit" id="login-btn">Entrar</button>
        </form>
        <p class="login-foot">Acesso restrito — solicite suas credenciais ao administrador.</p>
      </div>`;

    this._userInput = this.el.querySelector('#login-user');
    this._passInput = this.el.querySelector('#login-pass');
    this._errorEl = this.el.querySelector('#login-error');
    this._btn = this.el.querySelector('#login-btn');

    this.el.querySelector('#login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = this._userInput.value.trim();
      const password = this._passInput.value;
      if (!email || !password) {
        this._error('Informe e-mail e senha.');
        return;
      }
      this._btn.disabled = true;
      this._btn.textContent = 'Entrando…';
      this._errorEl.classList.add('hidden');
      try {
        const user = await cloudLogin(email, password);
        if (!user) {
          this._error('E-mail ou senha inválidos.');
        } else {
          this._user = user;
          this._passInput.value = '';
          this.hide();
          this.app.onLoggedIn();
        }
      } catch (err) {
        this._error('Falha ao conectar: ' + err.message);
      } finally {
        this._btn.disabled = false;
        this._btn.textContent = 'Entrar';
      }
    });
  }

  _error(msg) {
    this._errorEl.textContent = msg;
    this._errorEl.classList.remove('hidden');
  }
}
