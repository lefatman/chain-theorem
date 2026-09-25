/**
 * Ability card (R-ABIL-005, 5.7): name, category label (5.1), affinity, level requirement, slot
 * cost, charges, eligibility and rules text. Used by the loadout builder library and, compact, by
 * the Dossier and the piece detail card.
 */
import type { ComponentChildren } from 'preact';
import type { AbilityDef, ElementId } from '@chain-theorem/rules';
import { CategoryTag, ElementBadge } from './bits.tsx';
import { chargesText, eligibleText } from './labels.ts';

export function AbilityFacts({ def }: { def: AbilityDef }) {
  return (
    <ul class="facts">
      <li>
        <ElementBadge el={def.affinity} suffix="affinity" />
      </li>
      <li>Level {def.minLevel}</li>
      <li>
        {def.slotCost} slot{def.slotCost === 1 ? '' : 's'}
      </li>
      <li>{chargesText(def.limits.charges)}</li>
      <li>{eligibleText(def)}</li>
    </ul>
  );
}

export function AbilityCard({
  def,
  elements,
  locked,
  children,
}: {
  def: AbilityDef;
  /** The builder's elements: marks cards that would be Attuned (6.3). */
  elements?: readonly ElementId[];
  /** A reason the card cannot be used now (level, capacity); shown as text, not only greyed out. */
  locked?: string | null;
  children?: ComponentChildren;
}) {
  const attuned =
    def.affinity !== 'neutral' && elements?.includes(def.affinity) && def.attuned !== undefined;
  return (
    <article class={`ability-card ${locked ? 'locked' : ''}`} aria-label={def.name}>
      <header>
        <h4>{def.name}</h4>
        <CategoryTag cat={def.category} />
      </header>
      <AbilityFacts def={def} />
      <p class="short">{def.text.short}</p>
      <p class="rules">{def.text.rules}</p>
      {attuned && (
        <p class="note ok">
          <span aria-hidden="true">{'★'}</span> Attuned on your{' '}
          {def.affinity.charAt(0).toUpperCase() + def.affinity.slice(1)} pieces
        </p>
      )}
      {locked && (
        <p class="note warn">
          <span aria-hidden="true">{'⚠︎'}</span> {locked}
        </p>
      )}
      {children && <div class="card-actions">{children}</div>}
    </article>
  );
}
