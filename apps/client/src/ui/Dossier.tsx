/**
 * Dossier (8.3, R-INFO-003): known opponent abilities by piece type with complete / partial
 * markers, known items, veiled piece types, and deductions the engine can prove from public facts
 * (engine.deduce), shown behind the "deduction hints" setting. Reads the projection only.
 */
import { useMemo } from 'preact/hooks';
import { abilityById, engine, itemById } from '@chain-theorem/content';
import { PIECE_TYPES, opposite, type PublicState } from '@chain-theorem/rules';
import { settings, updateSettings } from '../state/settings.ts';
import { CategoryTag, ElementBadge, PieceGlyph } from './bits.tsx';
import { GROUP_A_TEXT, GROUP_B_TEXT, cap, sideName } from './labels.ts';

const YES_NO = { yes: 'Yes', no: 'No', unknown: 'Unknown' } as const;

export function Dossier({ pub, formatName }: { pub: PublicState; formatName: string }) {
  const opp = opposite(pub.viewer);
  const army = pub.armies[opp];
  const known = army.revealed;
  const hints = settings.value.deductionHints;
  // Deductions depend only on the opponent's public facts; recompute when those change.
  const key = JSON.stringify([known, army.level, army.consumedSlots, army.elements]);
  const d = useMemo(() => (hints ? engine.deduce(pub) : null), [hints, key]);
  const knownCost = known.items.reduce((n, id) => n + (itemById.get(id)?.slotCost ?? 0), 0);
  const unexplained = Math.max(0, army.consumedSlots - knownCost);
  const aboutMe = pub.armies[pub.viewer].revealed;
  const meSeen = PIECE_TYPES.filter((t) => (aboutMe.abilities[t] ?? []).length > 0);

  return (
    <section class="dossier" aria-labelledby="dossier-h">
      <h3 id="dossier-h">Dossier: {sideName(opp)}</h3>
      <dl class="facts-list">
        <dt>Level</dt>
        <dd>{army.level}</dd>
        <dt>Element{army.elements.length > 1 ? 's' : ''}</dt>
        <dd>
          {army.elements.length > 1 ? (
            <>
              <ElementBadge el={army.elements[0] ?? 'neutral'} />{' '}
              <span class="muted">A: {GROUP_A_TEXT}</span>
              <br />
              <ElementBadge el={army.elements[1] ?? 'neutral'} />{' '}
              <span class="muted">B: {GROUP_B_TEXT}</span>
            </>
          ) : (
            <ElementBadge el={army.elements[0] ?? 'neutral'} />
          )}
        </dd>
        <dt>Item slots used</dt>
        <dd>{army.consumedSlots}</dd>
        <dt>Objective</dt>
        <dd>
          {formatName}: you {pub.objective[pub.viewer]} · them {pub.objective[opp]}
        </dd>
      </dl>

      <h4>Abilities by piece type</h4>
      <ul class="dossier-types">
        {PIECE_TYPES.map((t) => {
          const list = known.abilities[t] ?? [];
          const complete = known.complete.includes(t);
          const veiled = known.veiled.includes(t);
          return (
            <li key={t}>
              <span class="dt-type">
                <PieceGlyph type={t} side={opp} /> {cap(t)}
              </span>
              <span class="dt-abilities">
                {list.length === 0 && !complete && <span class="muted">nothing seen</span>}
                {list.length === 0 && complete && <span class="muted">no abilities</span>}
                {list.map((a) => {
                  const def = abilityById.get(a);
                  return (
                    <span key={a} class="chip" title={def?.text.rules}>
                      {def?.name ?? a} {def && <CategoryTag cat={def.category} />}
                    </span>
                  );
                })}
              </span>
              <span class={`dt-mark ${complete ? 'complete' : 'partial'}`}>
                {complete ? (
                  <>
                    <span aria-hidden="true">{'✓'}</span> Complete
                  </>
                ) : list.length > 0 ? (
                  <>
                    <span aria-hidden="true">+?</span> Partial
                  </>
                ) : (
                  <>
                    <span aria-hidden="true">?</span> Unknown
                  </>
                )}
                {veiled && (
                  <>
                    {' '}
                    <span aria-hidden="true">{'◐'}</span> Veiled
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      <h4>Items</h4>
      <p>
        {known.items.length > 0
          ? known.items.map((i) => itemById.get(i)?.name ?? i).join(', ')
          : known.allItems
            ? 'No items.'
            : 'None seen yet.'}
        {known.allItems ? (
          <span class="note ok">
            {' '}
            <span aria-hidden="true">{'✓'}</span> Full list known
          </span>
        ) : (
          unexplained > 0 && (
            <span class="muted">
              {' '}
              ({unexplained} slot{unexplained === 1 ? '' : 's'} still unexplained)
            </span>
          )
        )}
      </p>

      <div class="deduce-head">
        <h4>Deductions</h4>
        <label class="check small">
          <input
            type="checkbox"
            checked={hints}
            onChange={(e) =>
              updateSettings({ deductionHints: (e.target as HTMLInputElement).checked })
            }
          />{' '}
          Show hints
        </label>
      </div>
      {d ? (
        <div class="deductions">
          <ul>
            {d.certainItems.length > 0 && (
              <li>
                Certainly equipped:{' '}
                {d.certainItems.map((i) => itemById.get(i)?.name ?? i).join(', ')}
              </li>
            )}
            <li>
              Ability capacity:{' '}
              {d.capacity.min === d.capacity.max
                ? d.capacity.min
                : `${d.capacity.min} to ${d.capacity.max}`}
            </li>
            <li>Separate sets per piece type: {YES_NO[d.schedule]}</li>
            <li>Blended Family: {YES_NO[d.blended]}</li>
            {d.impossibleItems.length > 0 && (
              <li>
                Ruled out: {d.impossibleItems.map((i) => itemById.get(i)?.name ?? i).join(', ')}
              </li>
            )}
            {d.hints.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
          <p class="muted">
            {d.combinations} item combination{d.combinations === 1 ? '' : 's'} fit what you have
            seen
            {d.truncated ? ' (search stopped early; some deductions may be missing)' : ''}.
          </p>
        </div>
      ) : (
        <p class="muted">Hints are hidden.</p>
      )}

      <details class="about-me">
        <summary>What {sideName(opp)} knows about you</summary>
        {meSeen.length === 0 && aboutMe.items.length === 0 ? (
          <p class="muted">Nothing revealed yet.</p>
        ) : (
          <ul>
            {meSeen.map((t) => (
              <li key={t}>
                <PieceGlyph type={t} side={pub.viewer} /> {cap(t)}:{' '}
                {(aboutMe.abilities[t] ?? []).map((a) => abilityById.get(a)?.name ?? a).join(', ')}
                {aboutMe.complete.includes(t) ? ' (complete)' : ''}
              </li>
            ))}
            {aboutMe.items.length > 0 && (
              <li>Items: {aboutMe.items.map((i) => itemById.get(i)?.name ?? i).join(', ')}</li>
            )}
          </ul>
        )}
      </details>
    </section>
  );
}
