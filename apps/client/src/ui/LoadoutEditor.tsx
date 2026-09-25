/**
 * Loadout builder (M3 step 3.2; R-LOAD-001..004, R-ELEM-004). Elements with the Blended Family A/B
 * groups explained, items with a slot meter (consumed / unlocked by level), ability sets with a
 * capacity meter, per-type sets with Multitasker's Schedule, drag or button reordering (order =
 * resolution order, 5.4) and live validation using the engine's own R-LOAD-004 errors.
 */
import { useState } from 'preact/hooks';
import { CAPS, abilities, abilityById, engine, itemById, items } from '@chain-theorem/content';
import {
  PIECE_TYPES,
  eligibleFor,
  type Category,
  type ElementId,
  type ItemDef,
  type Loadout,
  type LoadoutError,
  type LoadoutValidation,
  type PieceType,
} from '@chain-theorem/rules';
import type { SavedLoadout } from '../state/profile.ts';
import { AbilityCard } from './AbilityCard.tsx';
import { CategoryTag, ElementBadge, Meter, PieceGlyph, type MeterCell } from './bits.tsx';
import {
  CATEGORY_LABEL,
  ELEMENT_NAME,
  GROUP_A_TEXT,
  GROUP_B_TEXT,
  PIECE_PLURAL,
  cap,
  matchupText,
  ordinal,
  traitOf,
} from './labels.ts';
import {
  abilityBlock,
  editSet,
  equipItem,
  itemBlock,
  levelForSlots,
  moveInSet,
  replacedBy,
  setCost,
  setPerType,
  setType,
  shapeOf,
  unequipItem,
} from './loadoutEdit.ts';

const RULE_NAME: Record<LoadoutError['rule'], string> = {
  1: 'item slots',
  2: 'level requirements',
  3: 'one item per group',
  4: 'set capacity',
  5: 'number of sets',
  6: 'elements',
  7: 'ownership',
};

const CATEGORIES: Category[] = ['CAPTURING', 'CAPTURES', 'CAPTURED', 'PASSIVE'];

export interface EditorProps {
  initial: SavedLoadout;
  isNew: boolean;
  onSave(l: SavedLoadout): string | null;
  onCancel(): void;
}

export function LoadoutEditor({ initial, isNew, onSave, onCancel }: EditorProps) {
  const [name, setName] = useState(initial.name);
  const [level, setLevel] = useState(initial.level);
  const [loadout, setLoadout] = useState<Loadout>(initial.loadout);
  const [active, setActive] = useState(0);
  const [message, setMessage] = useState('');
  const v = engine.validateLoadout(loadout, { level });
  const shape = shapeOf(loadout.items);
  const clampLevel = (n: number) => Math.max(1, Math.min(CAPS.LEVEL_CAP, Math.round(n) || 1));

  const save = () => {
    const err = onSave({ id: initial.id, name: name.trim() || 'Loadout', level, loadout });
    if (err) setMessage(err);
  };

  return (
    <main class="setup wide loadout-editor">
      <header class="screen-head">
        <h2>{isNew ? 'New loadout' : 'Edit loadout'}</h2>
        <p class="muted">
          Local play unlocks every card and item; the level sets which ones this loadout may use.
        </p>
      </header>

      <section class="panel basics" aria-label="Name and level">
        <label>
          Name
          <input
            value={name}
            maxLength={40}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
          />
        </label>
        <label>
          Level
          <span class="level-input">
            <input
              type="range"
              min={1}
              max={CAPS.LEVEL_CAP}
              value={level}
              aria-label="Level slider"
              onInput={(e) => setLevel(clampLevel(Number((e.target as HTMLInputElement).value)))}
            />
            <input
              type="number"
              min={1}
              max={CAPS.LEVEL_CAP}
              value={level}
              onInput={(e) => setLevel(clampLevel(Number((e.target as HTMLInputElement).value)))}
            />
          </span>
        </label>
      </section>

      <ElementsSection loadout={loadout} onChange={setLoadout} />
      <ItemsSection loadout={loadout} level={level} v={v} onChange={setLoadout} />
      <SetsSection
        loadout={loadout}
        level={level}
        capacity={shape.capacity}
        perTypeAllowed={shape.perTypeSets}
        active={active}
        setActive={setActive}
        v={v}
        onChange={setLoadout}
      />

      <section class="panel validation" aria-labelledby="val-h" aria-live="polite">
        <h3 id="val-h">Check</h3>
        {v.ok ? (
          <p class="note ok">
            <span aria-hidden="true">{'✓'}</span> Ready for battle: this loadout passes every
            loadout rule (R-LOAD-004).
          </p>
        ) : (
          <ul class="errors">
            {v.errors.map((e, i) => (
              <li key={`${e.code}-${e.ref ?? ''}-${i}`}>
                <span aria-hidden="true">{'⚠︎'}</span> Rule {e.rule} ({RULE_NAME[e.rule]}
                ): {e.message}
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer class="save-bar">
        <span class="save-status">
          {v.ok ? (
            <>
              <span aria-hidden="true">{'✓'}</span> Valid
            </>
          ) : (
            <>
              <span aria-hidden="true">{'⚠︎'}</span> {v.errors.length} problem
              {v.errors.length === 1 ? '' : 's'}
            </>
          )}
          {message && <span class="warn"> · {message}</span>}
        </span>
        <button onClick={onCancel}>Cancel</button>
        <button
          class="primary"
          disabled={!v.ok}
          title={v.ok ? undefined : 'Fix the problems listed under Check to save'}
          onClick={save}
        >
          Save
        </button>
      </footer>
    </main>
  );
}

// ---- elements (6.4) --------------------------------------------------------------------------------

function ElementsSection({ loadout, onChange }: { loadout: Loadout; onChange(l: Loadout): void }) {
  const blended = loadout.elements.length === 2;
  const pick = (index: number, el: ElementId) =>
    onChange({ ...loadout, elements: loadout.elements.map((x, i) => (i === index ? el : x)) });
  const blendedDef = items.find((i) => i.grants?.secondElement);
  return (
    <section class="panel" aria-labelledby="el-h">
      <h3 id="el-h">
        <span class="step-num">1</span> Element{blended ? 's' : ''}
      </h3>
      {blended ? (
        <>
          <p class="muted">
            Blended Family splits your army by piece type: group A ({GROUP_A_TEXT}) takes element A,
            group B ({GROUP_B_TEXT}) takes element B. Silence, traits and attunement work per piece;
            a promoted pawn joins its new type's group. Your opponent sees both elements and which
            group holds each.
          </p>
          <ElementPicker
            name="el-a"
            label={`Element A: ${GROUP_A_TEXT}`}
            value={loadout.elements[0] ?? 'ember'}
            taken={loadout.elements[1] ?? null}
            onPick={(el) => pick(0, el)}
          />
          <ElementPicker
            name="el-b"
            label={`Element B: ${GROUP_B_TEXT}`}
            value={loadout.elements[1] ?? 'tide'}
            taken={loadout.elements[0] ?? null}
            onPick={(el) => pick(1, el)}
          />
        </>
      ) : (
        <>
          <ElementPicker
            name="el"
            label="Army element (all 16 pieces)"
            value={loadout.elements[0] ?? 'ember'}
            taken={null}
            onPick={(el) => pick(0, el)}
          />
          {blendedDef && (
            <p class="muted">
              Equip {blendedDef.name} (level {blendedDef.minLevel}) to field two elements split by
              piece type.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function ElementPicker({
  name,
  label,
  value,
  taken,
  onPick,
}: {
  name: string;
  label: string;
  value: ElementId;
  taken: ElementId | null;
  onPick(el: ElementId): void;
}) {
  return (
    <fieldset class="element-picker">
      <legend>{label}</legend>
      <div class="choice-grid">
        {CAPS.ENABLED_ELEMENTS.map((el) => {
          const t = traitOf(el);
          const used = taken === el;
          return (
            <label key={el} class={`choice el-card el-${el} ${value === el ? 'on' : ''}`}>
              <input
                type="radio"
                name={name}
                value={el}
                checked={value === el}
                disabled={used}
                onChange={() => onPick(el)}
              />
              <span class="choice-title">
                <ElementBadge el={el} />
                {value === el && <span class="chosen"> (chosen)</span>}
              </span>
              {t && (
                <span class="choice-body">
                  <strong>{t.name}</strong>: {t.short}
                </span>
              )}
              <span class="choice-meta">{matchupText(el)}</span>
              {used && <span class="choice-meta warn">Used by the other group</span>}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

// ---- items (7.1, 7.2) ------------------------------------------------------------------------------

function slotCells(loadout: Loadout, level: number): MeterCell[] {
  const unlocked = CAPS.itemSlots(level);
  const cells: MeterCell[] = [];
  for (const id of loadout.items) {
    const def = itemById.get(id);
    if (!def) continue;
    for (let k = 0; k < def.slotCost; k++) {
      cells.push({ state: cells.length < unlocked ? 'used' : 'over', label: def.name });
    }
  }
  while (cells.length < unlocked) cells.push({ state: 'free', label: 'Free slot' });
  while (cells.length < CAPS.MAX_ITEM_SLOTS) {
    const at = levelForSlots(cells.length + 1);
    cells.push({ state: 'locked', label: at ? `Unlocks at level ${at}` : 'Locked' });
  }
  return cells;
}

function ItemsSection({
  loadout,
  level,
  v,
  onChange,
}: {
  loadout: Loadout;
  level: number;
  v: LoadoutValidation;
  onChange(l: Loadout): void;
}) {
  const unlocked = CAPS.itemSlots(level);
  const next = levelForSlots(unlocked + 1);
  const cells = slotCells(loadout, level);
  return (
    <section class="panel" aria-labelledby="items-h">
      <h3 id="items-h">
        <span class="step-num">2</span> Items
      </h3>
      <Meter
        label="Item slots"
        cells={cells}
        summary={
          <>
            <strong>
              {v.consumedSlots} of {unlocked}
            </strong>{' '}
            item slot{unlocked === 1 ? '' : 's'} used at level {level}
            {next ? ` · slot ${unlocked + 1} unlocks at level ${next}` : ' · all slots unlocked'}
          </>
        }
      />
      <p class="muted">
        Capacity items set how many ability slots each set has (without one:{' '}
        {CAPS.BASE_ABILITY_CAPACITY}
        ); only one can be equipped. Every other item costs 1 slot.
      </p>
      <div class="card-grid">
        {items
          .filter((i) => !i.retired)
          .map((it) => (
            <ItemCard
              key={it.id}
              def={it}
              loadout={loadout}
              level={level}
              errors={v.errors.filter((e) => e.ref === it.id)}
              onChange={onChange}
            />
          ))}
      </div>
    </section>
  );
}

function ItemCard({
  def,
  loadout,
  level,
  errors,
  onChange,
}: {
  def: ItemDef;
  loadout: Loadout;
  level: number;
  errors: LoadoutError[];
  onChange(l: Loadout): void;
}) {
  const on = loadout.items.includes(def.id);
  const block = on ? null : itemBlock(loadout, level, def.id);
  const swap = on ? null : replacedBy(loadout, def.id);
  const param = loadout.itemParams?.[def.id]?.element;
  return (
    <article class={`item-card ${on ? 'on' : ''} ${block ? 'locked' : ''}`} aria-label={def.name}>
      <header>
        <h4>
          {on && (
            <span class="equipped-mark" aria-hidden="true">
              {'✓ '}
            </span>
          )}
          {def.name}
        </h4>
        <span class="slot-cost">
          {def.slotCost} slot{def.slotCost > 1 ? 's' : ''}
        </span>
      </header>
      <ul class="facts">
        <li>Level {def.minLevel}</li>
        {def.capacity !== undefined && <li>Capacity {def.capacity}</li>}
        {def.grants?.perTypeSets && <li>Six per-type sets</li>}
        {def.grants?.secondElement && <li>Two elements</li>}
        {def.param?.element === 'required' && <li>Choose an element</li>}
      </ul>
      <p class="short">{def.text.short}</p>
      <p class="rules">{def.text.rules}</p>
      {on && def.param?.element === 'required' && (
        <label class="inline">
          Element
          <select
            value={param ?? ''}
            onChange={(e) =>
              onChange({
                ...loadout,
                itemParams: {
                  ...loadout.itemParams,
                  [def.id]: { element: (e.target as HTMLSelectElement).value as ElementId },
                },
              })
            }
          >
            <option value="" disabled>
              choose...
            </option>
            {CAPS.ENABLED_ELEMENTS.map((x) => (
              <option key={x} value={x}>
                {ELEMENT_NAME[x]}
              </option>
            ))}
          </select>
        </label>
      )}
      {errors.map((e, i) => (
        <p key={i} class="note warn">
          <span aria-hidden="true">{'⚠︎'}</span> {e.message}
        </p>
      ))}
      {block && (
        <p class="note warn">
          <span aria-hidden="true">{'⚠︎'}</span> {block}
        </p>
      )}
      <div class="card-actions">
        <button
          aria-pressed={on}
          disabled={!on && block !== null}
          onClick={() => onChange(on ? unequipItem(loadout, def.id) : equipItem(loadout, def.id))}
        >
          {on ? 'Remove' : swap ? `Equip (replaces ${itemById.get(swap)?.name ?? swap})` : 'Equip'}
        </button>
      </div>
    </article>
  );
}

// ---- ability sets (7.3) ----------------------------------------------------------------------------

function SetsSection({
  loadout,
  level,
  capacity,
  perTypeAllowed,
  active,
  setActive,
  v,
  onChange,
}: {
  loadout: Loadout;
  level: number;
  capacity: number;
  perTypeAllowed: boolean;
  active: number;
  setActive(n: number): void;
  v: LoadoutValidation;
  onChange(l: Loadout): void;
}) {
  const perType = loadout.sets.length === 6;
  const index = perType ? Math.min(active, 5) : 0;
  const set = loadout.sets[index] ?? [];
  const type = setType(loadout, index);
  const schedule = items.find((i) => i.grants?.perTypeSets);
  return (
    <section class="panel" aria-labelledby="sets-h">
      <h3 id="sets-h">
        <span class="step-num">3</span> Ability {perType ? 'sets' : 'set'}
      </h3>
      <p class="muted">
        Each set holds up to <strong>{capacity}</strong> ability slot{capacity === 1 ? '' : 's'}.
        The order is the resolution order: when several abilities of one piece trigger together, the
        first in the list resolves first (5.4).
      </p>
      {perTypeAllowed ? (
        <div class="seg" role="group" aria-label="Set layout">
          <button aria-pressed={!perType} onClick={() => onChange(setPerType(loadout, false))}>
            One army-wide set
          </button>
          <button aria-pressed={perType} onClick={() => onChange(setPerType(loadout, true))}>
            A set per piece type
          </button>
        </div>
      ) : (
        schedule && (
          <p class="muted">
            Equip {schedule.name} (level {schedule.minLevel}) for a separate set per piece type.
          </p>
        )
      )}
      {perType && (
        <div class="seg type-tabs" role="group" aria-label="Piece type set">
          {PIECE_TYPES.map((t, i) => {
            const cost = setCost(loadout.sets[i] ?? []);
            return (
              <button key={t} aria-pressed={i === index} onClick={() => setActive(i)}>
                <PieceGlyph type={t} /> {cap(t)}{' '}
                <span class={`count ${cost > capacity ? 'over' : ''}`}>
                  {cost}/{capacity}
                  {cost > capacity ? ' !' : ''}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <div class="set-editor">
        <SetList
          loadout={loadout}
          index={index}
          capacity={capacity}
          errors={v.errors}
          onChange={onChange}
        />
        <Library
          set={set}
          type={type}
          capacity={capacity}
          level={level}
          elements={loadout.elements}
          onAdd={(id) => onChange(editSet(loadout, index, (s) => [...s, id]))}
        />
      </div>
    </section>
  );
}

function SetList({
  loadout,
  index,
  capacity,
  errors,
  onChange,
}: {
  loadout: Loadout;
  index: number;
  capacity: number;
  errors: LoadoutError[];
  onChange(l: Loadout): void;
}) {
  const [drag, setDrag] = useState<{ from: number; over: number | null } | null>(null);
  const set = loadout.sets[index] ?? [];
  const type = setType(loadout, index);
  const cost = setCost(set);
  const cells: MeterCell[] = [];
  for (let k = 0; k < Math.max(capacity, cost); k++)
    cells.push({ state: k < cost ? (k < capacity ? 'used' : 'over') : 'free' });
  const move = (from: number, to: number) =>
    onChange(editSet(loadout, index, (s) => moveInSet(s, from, to)));
  const title = type ? `${cap(type)} set` : 'Army-wide set';
  return (
    <div class="set-list">
      <h4>
        {type && <PieceGlyph type={type} />} {title}
      </h4>
      <Meter
        label={`${title} capacity`}
        cells={cells}
        summary={
          <>
            <strong>
              {cost} of {capacity}
            </strong>{' '}
            ability slots{cost > capacity ? ' (over capacity)' : ''}
          </>
        }
      />
      {set.length === 0 ? (
        <p class="muted">Empty. Add abilities from the library.</p>
      ) : (
        <ol class="set-items">
          {set.map((id, i) => {
            const def = abilityById.get(id);
            const own = errors.filter((e) => e.ref === id && (e.rule === 2 || e.rule === 7));
            const ineligible =
              def && (type ? !eligibleFor(def, type) : def.eligible !== 'all') ? def : null;
            return (
              <li
                key={id}
                class={`set-item ${drag?.over === i ? 'drop' : ''} ${drag?.from === i ? 'dragging' : ''}`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer?.setData('text/plain', String(i));
                  setDrag({ from: i, over: null });
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (drag && drag.over !== i) setDrag({ ...drag, over: i });
                }}
                onDragEnd={() => setDrag(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  if (drag) move(drag.from, i);
                  setDrag(null);
                }}
              >
                <span class="handle" aria-hidden="true" title="Drag to reorder">
                  {'⠇'}
                </span>
                <span class="order">{ordinal(i + 1)}</span>
                <span class="set-name">
                  <strong>{def?.name ?? id}</strong>
                  {def && <CategoryTag cat={def.category} />}
                  {def && <ElementBadge el={def.affinity} />}
                  {ineligible && (
                    <span class="note warn">
                      <span aria-hidden="true">{'⚠︎'}</span>{' '}
                      {type
                        ? `Does nothing on ${PIECE_PLURAL[type]} (still uses a slot)`
                        : `Does nothing on the ${skippedText(ineligible.eligible)} (still uses a slot)`}
                    </span>
                  )}
                  {own.map((e, k) => (
                    <span key={k} class="note warn">
                      <span aria-hidden="true">{'⚠︎'}</span> {e.message}
                    </span>
                  ))}
                </span>
                <span class="row-actions">
                  <button
                    aria-label={`Move ${def?.name ?? id} up`}
                    disabled={i === 0}
                    onClick={() => move(i, i - 1)}
                  >
                    {'↑'}
                  </button>
                  <button
                    aria-label={`Move ${def?.name ?? id} down`}
                    disabled={i === set.length - 1}
                    onClick={() => move(i, i + 1)}
                  >
                    {'↓'}
                  </button>
                  <button
                    aria-label={`Remove ${def?.name ?? id}`}
                    onClick={() =>
                      onChange(editSet(loadout, index, (s) => s.filter((x) => x !== id)))
                    }
                  >
                    {'✕'}
                  </button>
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {type && (
        <button
          class="small"
          disabled={set.length === 0}
          onClick={() => onChange({ ...loadout, sets: PIECE_TYPES.map(() => [...set]) })}
        >
          Copy this set to every piece type
        </button>
      )}
    </div>
  );
}

/** The piece types an ability does nothing on (7.3: it still uses the slot). */
function skippedText(eligible: readonly PieceType[] | 'all'): string {
  if (eligible === 'all') return 'nothing';
  return PIECE_TYPES.filter((t) => !eligible.includes(t))
    .map((t) => PIECE_PLURAL[t])
    .join(', ');
}

function Library({
  set,
  type,
  capacity,
  level,
  elements,
  onAdd,
}: {
  set: readonly string[];
  type: ReturnType<typeof setType>;
  capacity: number;
  level: number;
  elements: readonly ElementId[];
  onAdd(id: string): void;
}) {
  const [cat, setCat] = useState<Category | 'all'>('all');
  const [aff, setAff] = useState<ElementId | 'all'>('all');
  const [hideLocked, setHideLocked] = useState(false);
  const affinities = [...new Set(abilities.map((a) => a.affinity))];
  const shown = abilities
    .filter((a) => !a.retired)
    .filter((a) => cat === 'all' || a.category === cat)
    .filter((a) => aff === 'all' || a.affinity === aff)
    .filter((a) => !hideLocked || a.minLevel <= level)
    .sort((a, b) => a.minLevel - b.minLevel || a.name.localeCompare(b.name));
  return (
    <div class="library">
      <h4>Library</h4>
      <div class="filters">
        <label class="inline">
          Category
          <select
            value={cat}
            onChange={(e) => setCat((e.target as HTMLSelectElement).value as Category | 'all')}
          >
            <option value="all">All</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </label>
        <label class="inline">
          Affinity
          <select
            value={aff}
            onChange={(e) => setAff((e.target as HTMLSelectElement).value as ElementId | 'all')}
          >
            <option value="all">All</option>
            {affinities.map((x) => (
              <option key={x} value={x}>
                {ELEMENT_NAME[x]}
              </option>
            ))}
          </select>
        </label>
        <label class="check">
          <input
            type="checkbox"
            checked={hideLocked}
            onChange={(e) => setHideLocked((e.target as HTMLInputElement).checked)}
          />{' '}
          Hide above level {level}
        </label>
      </div>
      <div class="card-grid">
        {shown.map((a) => {
          const block = abilityBlock(set, capacity, level, a.id);
          const warn =
            type && !eligibleFor(a, type) ? `Does nothing on ${PIECE_PLURAL[type]}` : null;
          return (
            <AbilityCard key={a.id} def={a} elements={elements} locked={block ?? warn}>
              <button disabled={block !== null} onClick={() => onAdd(a.id)}>
                {block === 'Already in this set' ? 'In set' : 'Add to set'}
              </button>
            </AbilityCard>
          );
        })}
        {shown.length === 0 && <p class="muted">No abilities match these filters.</p>}
      </div>
    </div>
  );
}
