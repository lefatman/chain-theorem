/**
 * Duelist's Gauntlet (R-LOAD-002; PLAYTEST; designer brief 2026-10-09, plan item C7; DD-126). A trade
 * made at build time, the item form of 6.2's "abilities mitigate innate weaknesses" loop: the
 * wearer's When-capturing (CAPTURING) abilities are never silenced, and its When-captured (CAPTURED)
 * abilities are always silenced when the foil captures them, under every scope and however often it
 * has already happened. Under ALL_TRIGGERS and REACTIONS_ONLY the element rule does that by itself;
 * under ONCE_PER_ABILITY the element silences each ability once (recording the once, DD-108) and the
 * Gauntlet's own silence takes over from the second time on, so the public once-record stays
 * truthful. After-capturing (CAPTURES) abilities are silenced as usual; under scope OFF the item does
 * nothing.
 *
 * Revealed when it changes an outcome (8.2): when it spares a Capturing trigger the foil would have
 * silenced, and when its silence bites where the plain rule would have let the ability fire
 * (ONCE_PER_ABILITY after the once). Resonance Crystal's one spared silence still applies to a
 * Gauntlet-forced silence, since the engine asks every silenceOverride; negations (Pierce, Stonewall,
 * Stillness, Warden's Stopwatch) are not silences and are unaffected.
 */
import { defineItem } from '@chain-theorem/rules/sdk';
import { beats } from '@chain-theorem/rules';

const ID = 'duelists_gauntlet';

export default defineItem({
  id: ID,
  name: "Duelist's Gauntlet",
  version: 1,
  slotCost: 1,
  minLevel: 10,
  hooks: {
    // The wearer's When-capturing triggers are never silenced; sparing one is observable.
    silenceOverride: (ctx, t) => {
      const owner = ctx.owner;
      if (!owner || t.side !== owner || t.category !== 'CAPTURING') return false;
      if (!ctx.state.reveals[owner].items.includes(ID)) ctx.revealSelf('observed');
      return true;
    },
    // The wearer's When-captured triggers are silenced whenever the foil captures, however often.
    // Every scope but ONCE_PER_ABILITY silences them by the element rule alone; there the element
    // records its once and the Gauntlet silences from the second time on, which is observable.
    triggerFilter: (ctx, t) => {
      const owner = ctx.owner;
      if (!owner || t.side !== owner || t.category !== 'CAPTURED') return 'allow';
      if (ctx.caps.SILENCE_SCOPE !== 'ONCE_PER_ABILITY' || !beats(t.otherElement, t.element))
        return 'allow';
      const key = `${t.piece.type}:${t.ability.id}`;
      if (!(ctx.state.silenced?.[owner] ?? []).includes(key)) return 'allow';
      if (!ctx.state.reveals[owner].items.includes(ID)) ctx.revealSelf('observed');
      return 'silence';
    },
  },
  text: {
    short: 'Attack unsilenced; defend unheard.',
    rules:
      'Your When-capturing abilities are never silenced. Your When-captured abilities are always silenced when the foil captures them, however often it already has.',
  },
  status: 'PLAYTEST',
});
