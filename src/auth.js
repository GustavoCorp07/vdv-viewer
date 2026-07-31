// Tela de login corporativa do VDV Viewer.
// Usuários são criados manualmente no banco (função vdv_create_user).
import { cloudLogin } from './supabase.js';

const SESSION_KEY = 'vdv-viewer-user';

export class Auth {
  constructor(app) {
    this.app = app;
    this.el = document.getElementById('login-screen');
    this._build();
  }

  get user() {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY));
    } catch (_) { return null; }
  }

  init() {
    if (this.user) {
      this.hide();
      this.app.onLoggedIn();
    } else {
      this.show();
    }
  }

  show() {
    this.el.classList.remove('hidden');
    setTimeout(() => this._userInput.focus(), 60);
  }

  hide() {
    this.el.classList.add('hidden');
  }

  logout() {
    localStorage.removeItem(SESSION_KEY);
    this.app.onLoggedOut();
    this.show();
  }

  _build() {
    this.el.innerHTML = `
      <div class="login-card">
        <div class="login-logo">
          <svg viewBox="0 0 24 24" width="46" height="46" aria-hidden="true">
            <path d="M12 2 3 7v10l9 5 9-5V7l-9-5z" fill="none" stroke="#4da3ff" stroke-width="1.4"/>
            <path d="M3 7l9 5 9-5M12 12v10" fill="none" stroke="#4da3ff" stroke-width="1.4"/>
          </svg>
          <h1>VDV <b>Viewer</b></h1>
          <p class="login-credit">created by Gustavinho</p>
        </div>
        <p class="login-sub">Visualizador profissional de projetos 3D</p>
        <form id="login-form" autocomplete="off">
          <label>Usuário</label>
          <input type="text" id="login-user" placeholder="seu usuário" autocomplete="username" />
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
      const username = this._userInput.value.trim();
      const password = this._passInput.value;
      if (!username || !password) {
        this._error('Informe usuário e senha.');
        return;
      }
      this._btn.disabled = true;
      this._btn.textContent = 'Entrando…';
      this._errorEl.classList.add('hidden');
      try {
        const user = await cloudLogin(username, password);
        if (!user) {
          this._error('Usuário ou senha inválidos.');
        } else {
          localStorage.setItem(SESSION_KEY, JSON.stringify(user));
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
