/**
 * Saved loadouts (7.4: up to MAX_SAVED_LOADOUTS, PROVISIONAL) with a validity summary per loadout,
 * plus the builder (LoadoutEditor) for new and existing ones.
 */
import { useState } from 'preact/hooks';
import { MAX_SAVED_LOADOUTS, abilityById, engine, itemById } from '@chain-theorem/content';
import { PIECE_TYPES } from '@chain-theorem/rules';
import { go } from '../app/router.ts';
import { deleteLoadout, profile, saveLoadout, type SavedLoadout } from '../state/profile.ts';
import { ElementBadge, PieceGlyph } from './bits.tsx';
import { GROUP_A_TEXT, GROUP_B_TEXT } from './labels.ts';
import { LoadoutEditor } from './LoadoutEditor.tsx';

function newId(): string {
  return `l-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function blank(): SavedLoadout {
  return {
    id: newId(),
    name: 'New loadout',
    level: profile.value.level,
    loadout: { elements: ['ember'], items: [], sets: [[]] },
  };
}

const names = (ids: readonly string[]) => ids.map((id) => abilityById.get(id)?.name ?? id);

export function LoadoutsScreen() {
  const [editing, setEditing] = useState<{ l: SavedLoadout; isNew: boolean } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const list = profile.value.loadouts;
  const full = list.length >= MAX_SAVED_LOADOUTS;

  if (editing) {
    return (
      <LoadoutEditor
        key={editing.l.id}
        initial={editing.l}
        isNew={editing.isNew}
        onCancel={() => setEditing(null)}
        onSave={(l) => {
          const r = saveLoadout(l);
          if (!r.ok) return r.reason ?? 'Could not save';
          setEditing(null);
          return null;
        }}
      />
    );
  }

  return (
    <main class="setup wide">
      <header class="screen-head">
        <h2>Loadouts</h2>
        <p class="muted">
          {list.length} of {MAX_SAVED_LOADOUTS} saved
        </p>
      </header>
      <ul class="loadout-list">
        {list.map((l) => {
          const v = engine.validateLoadout(l.loadout, { level: l.level });
          const perType = l.loadout.sets.length === 6;
          return (
            <li key={l.id} class="loadout-row">
              <div class="lr-main">
                <h3>{l.name}</h3>
                <p>
                  Level {l.level} ·{' '}
                  {l.loadout.elements.map((el, i) => (
                    <span key={i}>
                      {i > 0 && ' / '}
                      <ElementBadge el={el} />
                    </span>
                  ))}
                  {l.loadout.elements.length === 2 && (
                    <span class="muted">
                      {' '}
                      (A: {GROUP_A_TEXT}; B: {GROUP_B_TEXT})
                    </span>
                  )}
                </p>
                <p class="muted">
                  Items:{' '}
                  {l.loadout.items.map((id) => itemById.get(id)?.name ?? id).join(', ') || 'none'}
                </p>
                {perType ? (
                  <ul class="type-sets">
                    {PIECE_TYPES.map((t, i) => (
                      <li key={t}>
                        <PieceGlyph type={t} />{' '}
                        {names(l.loadout.sets[i] ?? []).join(', ') || '(empty)'}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p class="muted">
                    Abilities (in order): {names(l.loadout.sets[0] ?? []).join(', ') || 'none'}
                  </p>
                )}
                <p class={v.ok ? 'note ok' : 'note warn'}>
                  <span aria-hidden="true">{v.ok ? '✓' : '⚠︎'}</span>{' '}
                  {v.ok
                    ? 'Valid'
                    : `${v.errors.length} problem${v.errors.length === 1 ? '' : 's'}: ${v.errors[0]?.message ?? ''}`}
                </p>
              </div>
              <div class="lr-actions">
                <button onClick={() => setEditing({ l, isNew: false })}>Edit</button>
                <button
                  disabled={full}
                  title={full ? `You can keep up to ${MAX_SAVED_LOADOUTS} loadouts` : undefined}
                  onClick={() =>
                    setEditing({
                      l: { ...l, id: newId(), name: `${l.name} (copy)` },
                      isNew: true,
                    })
                  }
                >
                  Duplicate
                </button>
                <button onClick={() => setConfirm(l.id)}>Delete</button>
              </div>
              {confirm === l.id && (
                <div class="confirm" role="alertdialog" aria-label={`Delete ${l.name}?`}>
                  <span>Delete “{l.name}”? This cannot be undone.</span>
                  <button
                    class="danger"
                    onClick={() => {
                      deleteLoadout(l.id);
                      setConfirm(null);
                    }}
                  >
                    Delete
                  </button>
                  <button onClick={() => setConfirm(null)}>Keep</button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {list.length === 0 && <p class="muted">No loadouts yet. Create one to start a battle.</p>}
      {full && (
        <p class="note">
          You can keep up to {MAX_SAVED_LOADOUTS} loadouts. Delete one to make room for another.
        </p>
      )}
      <div class="row">
        <button onClick={() => go('title')}>Back</button>
        <button
          class="primary"
          disabled={full}
          onClick={() => setEditing({ l: blank(), isNew: true })}
        >
          New loadout
        </button>
      </div>
    </main>
  );
}
