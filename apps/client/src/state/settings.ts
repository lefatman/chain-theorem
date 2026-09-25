/**
 * Presentation settings (11.2): Classic View, animation speed and fast mode, reduced motion, text
 * scaling, attack hints for newcomers (10.3) and Dossier deduction hints (8.3). Stored per browser.
 */
import { effect, signal } from '@preact/signals';

export interface Settings {
  classicView: boolean;
  fastMode: boolean;
  reducedMotion: boolean;
  textScale: number;
  attackHints: boolean;
  moveHighlights: boolean;
  deductionHints: boolean;
  passDevice: boolean;
}

const KEY = 'ct.settings.v1';
const prefersReduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const DEFAULTS: Settings = {
  classicView: false,
  fastMode: false,
  reducedMotion: prefersReduced,
  textScale: 1,
  attackHints: true,
  moveHighlights: true,
  deductionHints: true,
  passDevice: true,
};

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export const settings = signal<Settings>(load());

effect(() => {
  const s = settings.value;
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: settings last for this page only */
  }
  document.documentElement.style.setProperty('--text-scale', String(s.textScale));
  document.documentElement.dataset.reducedMotion = String(s.reducedMotion);
});

export function updateSettings(patch: Partial<Settings>): void {
  settings.value = { ...settings.value, ...patch };
}
