// Utilitários: easing, tweens e formatação numérica pt-BR.

export const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const lerp = (a, b, t) => a + (b - a) * t;

/** Gerenciador simples de tweens, atualizado a cada frame pelo viewer. */
export class TweenManager {
  constructor() { this.active = []; }

  add({ duration = 600, ease = easeInOutCubic, onUpdate, onComplete }) {
    const tw = { start: performance.now(), duration, ease, onUpdate, onComplete, dead: false };
    this.active.push(tw);
    return tw;
  }

  cancel(tw) { if (tw) tw.dead = true; }

  cancelAll() { for (const tw of this.active) tw.dead = true; }

  update(now) {
    if (!this.active.length) return;
    const done = [];
    for (const tw of this.active) {
      if (tw.dead) { done.push(tw); continue; }
      const t = clamp((now - tw.start) / tw.duration, 0, 1);
      tw.onUpdate(tw.ease(t), t);
      if (t >= 1) { done.push(tw); if (tw.onComplete) tw.onComplete(); }
    }
    if (done.length) this.active = this.active.filter((t) => !done.includes(t));
  }
}

/** Formata número em pt-BR: 1234.5 -> "1.234,5" */
export function fmt(n, decimals = 1) {
  return n.toLocaleString('pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

export function fmtMM(n) { return fmt(n, 1) + ' mm'; }
export function fmtM2(n) { return fmt(n, 3) + ' m²'; }

/** Número no CSV pt-BR (decimal com vírgula, sem separador de milhar). */
export function csvNum(n, decimals = 1) {
  return n.toFixed(decimals).replace('.', ',');
}
