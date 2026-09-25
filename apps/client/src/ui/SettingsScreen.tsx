/** Accessibility and presentation settings (11.2, 10.3). */
import { settings, updateSettings, type Settings } from '../state/settings.ts';
import { go } from '../app/router.ts';

const TOGGLES: [keyof Settings, string][] = [
  ['classicView', 'Classic View (chess glyphs instead of creatures)'],
  ['fastMode', 'Fast mode (reaction chains resolve in under a second)'],
  ['reducedMotion', 'Reduced motion (no animations)'],
  ['moveHighlights', 'Highlight legal moves'],
  ['attackHints', '"This square is attacked" hints'],
  ['deductionHints', 'Dossier deduction hints'],
  ['passDevice', 'Hot-seat: hide the board between turns'],
];

export function SettingsScreen() {
  const s = settings.value;
  return (
    <main class="setup">
      <h2>Settings</h2>
      {TOGGLES.map(([key, label]) => (
        <label class="check" key={key}>
          <input
            type="checkbox"
            checked={Boolean(s[key])}
            onChange={(e) => updateSettings({ [key]: (e.target as HTMLInputElement).checked })}
          />{' '}
          {label}
        </label>
      ))}
      <label>
        Text size
        <input
          type="range"
          min="0.85"
          max="1.6"
          step="0.05"
          value={s.textScale}
          onInput={(e) =>
            updateSettings({ textScale: Number((e.target as HTMLInputElement).value) })
          }
        />
      </label>
      <button onClick={() => go('title')}>Back</button>
    </main>
  );
}
