# Chain Theorem — Content Guide

How to add abilities, items and element traits. This guide mirrors spec 13.5 (R-DATA-005,
COMMITTED) and was checked against the code in `packages/rules/src/sdk`, `packages/rules/src/engine`,
`packages/content` and `apps/tools/src/content`. The binding rules stay in `docs/DESIGN.md` (the spec);
this guide cites the section, requirement ID or DD row for every rule it repeats. When two rules
conflict, precedence is INVARIANT > COMMITTED > ability or item text > PROVISIONAL (spec 0).

Reference style: a plain number such as 5.4 is a spec section; a number with § such as §3.9 is a
section of this guide.

The promise of 13.5: **adding content means adding one module file and its test.** The engine,
database, protocol and client need no changes. If an idea cannot be built from the existing effect
primitives and hooks, it is an engine change instead (§12).

## Contents

1. [The short version](#1-the-short-version)
2. [How content plugs into the engine](#2-how-content-plugs-into-the-engine)
3. [Ability modules](#3-ability-modules)
   - [3.1 Anatomy](#31-anatomy) · [3.2 Fields and validation](#32-fields-and-validation) ·
     [3.3 Category and timing](#33-category-and-timing) ·
     [3.4 Level requirement and slot cost](#34-level-requirement-and-slot-cost) ·
     [3.5 Eligibility](#35-eligibility) ·
     [3.6 Limits, charges and Overabundance](#36-limits-charges-and-overabundance) ·
     [3.7 Tags](#37-tags-replay-revive-and-wardens-stopwatch) ·
     [3.8 Trigger conditions](#38-trigger-conditions) · [3.9 Attuned versions](#39-attuned-versions) ·
     [3.10 Passive abilities](#310-passive-abilities)
4. [Effects](#4-effects)
   - [4.1 How an activation resolves](#41-how-an-activation-resolves) ·
     [4.2 Primitive reference](#42-primitive-reference) ·
     [4.3 Target selectors](#43-target-selectors) · [4.4 Square selectors](#44-square-selectors) ·
     [4.5 Anchors and the last known square](#45-anchors-and-the-last-known-square) ·
     [4.6 Choices](#46-choices) · [4.7 Conditional effects](#47-conditional-effects-fxwhen) ·
     [4.8 Chain-end effects](#48-chain-end-effects-fxatchainend) ·
     [4.9 Bonus actions and INV-01](#49-bonus-actions-and-inv-01) ·
     [4.10 Intercepts and fizzle reasons](#410-intercepts-and-fizzle-reasons)
5. [Item modules](#5-item-modules)
6. [Trait modules](#6-trait-modules)
7. [Hooks](#7-hooks)
   - [7.1 Order and owners](#71-order-and-owners) · [7.2 Contexts](#72-contexts) ·
     [7.3 State slices](#73-state-slices) · [7.4 Hook reference](#74-hook-reference)
8. [Hidden information and reveals](#8-hidden-information-and-reveals)
9. [Testing with scenario()](#9-testing-with-scenario)
10. [Worked example: adding an ability end to end](#10-worked-example-adding-an-ability-end-to-end)
11. [Versions, status and retirement](#11-versions-status-and-retirement)
12. [When the engine must change](#12-when-the-engine-must-change)
13. [NPC and AI implications](#13-npc-and-ai-implications)
14. [World content: zones, NPCs, lessons and quests](#14-world-content-zones-npcs-lessons-and-quests)
15. [Appendix A: SDK cheat sheet](#appendix-a-sdk-cheat-sheet)
16. [Appendix B: the catalogue as a pattern library](#appendix-b-the-catalogue-as-a-pattern-library)

## 1. The short version

The agent checklist from spec 13.5, with the real commands:

1. **Scaffold.** `pnpm content:new ability <id>` (or `item`, `trait`). It writes
   `packages/content/<abilities|items|traits>/<id>.ts` and `<id>.test.ts` from a template. The id
   must be snake_case (`^[a-z][a-z0-9_]*$`), and the command refuses an id whose file already exists,
   because shipped ids are retired, never reused.
2. **Fill in the data.** Category, affinity, eligibility, tags, level requirement (`minLevel`), slot
   cost (`slotCost`), charges, and effects from `fx.*` (§3 and §4). Items declare slot cost,
   level, loadout flags and hooks (§5); traits declare hooks (§6).
3. **Check it is expressible.** If no existing primitive or hook can express the rule, stop: add the
   primitive or hook to the SDK first, with its own tests, and log a DD row (§12).
4. **Test it.** Write at least one `scenario()` test (board setup, loadouts, moves, expected
   events), with requirement IDs in the test names (§9).
5. **Register it.** `pnpm content:index` regenerates `packages/content/registry.generated.ts`.
6. **Check it.** `pnpm content:validate`, then `pnpm check`. Nothing outside the module, its test and
   the generated registry should change.

| Command                                      | What it does                                                                                                                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm content:new ability\|item\|trait <id>` | Scaffolds a module and a scenario test from a template (`apps/tools/src/content/new.ts`)                                                                                        |
| `pnpm content:index`                         | Regenerates the registry from the module files; `content:validate` (and so CI) fails if it is stale                                                                             |
| `pnpm content:validate`                      | Validates every module (§3.2, §5.2, §6) and prints e.g. `content:validate ok: 14 abilities, 11 items, 6 traits`                                                                 |
| `pnpm check`                                 | Typecheck, lint, unit tests (content scenario tests included), `content:validate`, dependency rules                                                                             |
| `pnpm test`                                  | Unit, golden (E1–E9), content scenario and property tests                                                                                                                       |
| `pnpm test:fuzz`                             | 500 random battles with random valid loadouts drawn from the registry: no crash, bounded chains, identical replay (INV-04) and the R-SEC-001 payload scan. Your module is in it |
| `pnpm sim`                                   | Balance simulator; archetype builds pick abilities from module data, so new abilities are included (see the slot-cost caveat in §3.4)                                           |

## 2. How content plugs into the engine

- **One file, one default export.** A module default-exports `defineAbility(...)`, `defineItem(...)`
  or `defineTrait(...)` from `@chain-theorem/rules/sdk`. These are identity functions that type-check
  the definition against `AbilityDef`, `ItemDef` or `TraitDef` (`packages/rules/src/sdk/types.ts`).
- **The registry.** `pnpm content:index` imports every module into `registry.generated.ts`.
  `packages/content/index.ts` exports `registry`, `engine = createEngine(registry, CAPS)`,
  `makeEngine(capsOverrides)`, `abilityById`, `itemById`, `traitById` and everything in
  `config.ts`. The rules package never imports content (R-DATA-001).
- **Content version.** `CONTENT_VERSION` is a hash of every module's `[id, version]`. It is recorded in
  each battle (`GameState.contentVersion`, the `BattleStarted` event) so replays know which module
  versions they ran (13.5).
- **Everything reads data, not ids.** Loadout validation (R-LOAD-004), the Dossier deductions (8.3),
  move previews (8.4), NPC ability profiles, simulator builds, fuzzer loadouts and the client's log
  lines and loadout builder all read module fields. A new module shows up everywhere without edits.
  One exception: the board scene draws only Hot Foot's burning squares from state slices, so a new
  public board marker needs a client change (request it from the client owner).
- **Purity.** Hooks and effects run inside the rules engine, so the standing instructions apply to
  content too: pure, deterministic, no `Date`, `Math.random`, timers, I/O, `console`, and no
  module-level mutable state (one module object serves every battle and both sides). ESLint enforces
  purity only inside `packages/rules/src`; in `packages/content` it is on you, and the fuzzer's replay
  check (INV-04) will catch nondeterminism.
- **Numbers live in config.** PLAYTEST and PROVISIONAL numbers that are not module fields go in
  `packages/content/config.ts` (for example `HOT_FOOT_TURNS`, imported by `traits/hot_foot.ts`), never
  in engine code (spec 0).

`packages/content/config.ts` holds the caps that modules and the validator read:

| Cap                     | Value                                    | Used for                                                  |
| ----------------------- | ---------------------------------------- | --------------------------------------------------------- |
| `LEVEL_CAP`             | 30                                       | Upper bound of every `minLevel`                           |
| `itemSlots(level)`      | `Math.min(6, 1 + Math.floor(level / 5))` | Item slots unlocked by level (R-LOAD-001, COMMITTED)      |
| `MAX_ITEM_SLOTS`        | 6                                        | Upper bound of an item's slot cost check                  |
| `BASE_ABILITY_CAPACITY` | 1                                        | Capacity without a capacity item                          |
| `MAX_ABILITY_CAPACITY`  | 5                                        | Upper bound of an ability's `slotCost` and of `capacity`  |
| `MAX_CHAIN_DEPTH`       | 3                                        | Hard guard for nested pipelines (DD-12 makes the depth 1) |
| `SILENCE_SCOPE`         | `'ALL_TRIGGERS'`                         | Silence rule knob (6.2): `REACTIONS_ONLY`, `OFF`          |
| `ENABLED_ELEMENTS`      | `['ember', 'tide', 'grove']`             | Elements a real loadout may use (6.5)                     |
| `MAX_EVENTS_PER_ACTION` | 512                                      | Termination guard; exceeding it throws (unbounded chain)  |

## 3. Ability modules

### 3.1 Anatomy

`packages/content/abilities/poisoned_meat.ts`, the 13.5 example, with annotations added as comments:

```ts
/** Poisoned Meat (5.7, 13.5 example, PLAYTEST): Captured, Grove, all. Effect-capture the captor. */
import { defineAbility, fx, target } from '@chain-theorem/rules/sdk';

export default defineAbility({
  id: 'poisoned_meat', // unique, snake_case, equals the file name, never reused
  name: 'Poisoned Meat', // display name (log lines, loadout builder, Dossier)
  version: 1, // bump when behaviour changes (§11)
  category: 'CAPTURED', // when it fires: CAPTURING | CAPTURES | CAPTURED | PASSIVE (§3.3)
  affinity: 'grove', // a Grove bearer uses the attuned version (§3.9)
  eligible: 'all', // or a list of piece types (§3.5)
  tags: [], // 'replay' and/or 'revive' (§3.7)
  minLevel: 2, // level requirement, 1..CAPS.LEVEL_CAP (§3.4)
  slotCost: 1, // ability slots used, 1..CAPS.MAX_ABILITY_CAPACITY (§3.4)
  limits: { perAction: 1 }, // add `charges` to make it consumable (§3.6)
  effects: [fx.effectCapture(target.captor())], // ordered primitives (§4)
  attuned: { mode: 'append', effects: [fx.revealIfSurvives(target.captor())] },
  text: {
    short: 'Takes its captor down with it.', // one line for tooltips
    rules:
      'When captured, effect-capture the captor. Attuned: if the captor survives, reveal all its abilities.',
  },
  status: 'PLAYTEST', // COMMITTED | PROVISIONAL | PLAYTEST (§11)
});
```

The file header comment names the ability, its spec source and status, and states the rule in one
line. Every module in the repository follows that convention.

### 3.2 Fields and validation

`AbilityDef` lives in `packages/rules/src/sdk/types.ts`. The **content:validate** column is what
`apps/tools/src/content/validate.ts` checks; the last column is what else enforces or reads the field.

| Field        | Type                                                               | content:validate                                                              | Also enforced or read by                                                                    |
| ------------ | ------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `id`         | `string`                                                           | Unique among abilities; snake_case; matches a file name in `abilities/`       | `createEngine` throws `bad_setup` on a duplicate id; `content:new` refuses an existing file |
| `name`       | `string`                                                           | —                                                                             | Client log lines and loadout UI (via `abilityById`)                                         |
| `version`    | `number`                                                           | Positive integer                                                              | `CONTENT_VERSION`                                                                           |
| `category`   | `Category`                                                         | One of the four categories                                                    | Pipeline phase (§3.3)                                                                       |
| `affinity`   | `ElementId`                                                        | One of the six elements or `neutral`                                          | Attunement (§3.9)                                                                           |
| `eligible`   | `PieceType[] \| 'all'`                                             | `'all'` or a non-empty list of known piece types                              | Resolver skips ineligible types (§3.5)                                                      |
| `tags`       | `AbilityTag[]`                                                     | Known tags that match the effects (`replay` ⇔ bonusAction, `revive` ⇔ revive) | Warden's Stopwatch; the INV-01 property test (§3.7)                                         |
| `minLevel`   | `number`                                                           | Integer in 1..`CAPS.LEVEL_CAP` (30)                                           | `validateLoadout` rule 2 (`ability_level`)                                                  |
| `slotCost`   | `number`                                                           | Integer in 1..`CAPS.MAX_ABILITY_CAPACITY` (5)                                 | `validateLoadout` rule 4 (`capacity_exceeded`); Dossier capacity deductions                 |
| `limits`     | `{ perAction: 1; charges?: number }`                               | `perAction` is 1; `charges`, if set, is a positive integer                    | Resolver (§3.6)                                                                             |
| `conditions` | `Condition[]` (optional)                                           | —                                                                             | Resolver at queue time (§3.8)                                                               |
| `effects`    | `EffectSpec[]`                                                     | Non-empty unless `category` is `PASSIVE`                                      | Resolver (§4)                                                                               |
| `attuned`    | `{ effects; mode: 'replace' \| 'append'; conditions? }` (optional) | Not allowed when `affinity` is `neutral` (6.3)                                | Resolver (§3.9)                                                                             |
| `hooks`      | `Partial<RuleHooks>` (optional)                                    | Required when `category` is `PASSIVE`                                         | Hook runner (§7)                                                                            |
| `text`       | `{ short: string; rules: string }`                                 | Both non-blank                                                                | Client tooltips and catalogue                                                               |
| `status`     | `'COMMITTED' \| 'PROVISIONAL' \| 'PLAYTEST'`                       | One of the three                                                              | §11                                                                                         |
| `retired`    | `boolean` (optional)                                               | —                                                                             | `validateLoadout` rule 7 (`retired`); running battles keep it (DD-49, §11)                  |
| _test file_  | —                                                                  | `abilities/<id>.test.ts` exists and contains an `it(` or `test(` call         | Vitest (`pnpm test`)                                                                        |
| _registry_   | —                                                                  | `registry.generated.ts` equals a fresh `content:index` output                 | CI                                                                                          |

`content:validate` does **not** check that tags match effects, that `when` and `atChainEnd` are used
sensibly, or that the rules text matches the behaviour. Those are the scenario test's job.

### 3.3 Category and timing

The designer's three trigger moments are COMMITTED (5.1); the five-phase pipeline (5.3, R-ABIL-003)
decides exactly when each category resolves.

| Category    | UI label        | Owner  | Resolves                                                                                        |
| ----------- | --------------- | ------ | ----------------------------------------------------------------------------------------------- |
| `CAPTURING` | When capturing  | Captor | Phase 2 (Before capture), immediately, in loadout order, while the victim is still on the board |
| `CAPTURES`  | After capturing | Captor | Phase 4 (Reactions), queued after the victim's CAPTURED triggers                                |
| `CAPTURED`  | When captured   | Victim | Phase 4 (Reactions), queued first; the victim is already off the board                          |
| `PASSIVE`   | Always          | Any    | Never triggers; changes rules through hooks (§3.10)                                             |

Rules that follow from the pipeline and 5.4 (R-ABIL-004):

- Only **move captures** trigger abilities: normal captures, en passant and bonus-move captures.
  Effect captures never trigger CAPTURES or CAPTURED abilities. Castling triggers nothing (4.2).
- The reaction queue resolves first-in first-out and each activation resolves fully (choices and any
  nested pipeline included) before the next. Storm's Always First trait moves Storm triggers to the
  front (`queueOrder`).
- Within one piece, order is the owner's loadout order, a real choice players make.
- **Defenders can never prevent a capture** (5.1, D-03). A CAPTURED ability retaliates or
  compensates; it cannot undo the capture.
- A promoting captor's CAPTURES triggers come from its **new** type's set (R-RULES-002); its CAPTURING
  triggers come from the pawn set, because they resolve before the move. Silence uses the elements
  fixed when the move is committed (DD-36).
- A CAPTURING effect resolves before the victim is removed. If it removes the victim, the captor
  then moves without capturing (no reactions); if it displaces the captor, nothing moves. Either
  way the action is spent (INV-06). Design CAPTURING abilities to prepare the capture (reveal,
  negate, protect), not to replace it.
- Keep PASSIVE abilities rare: the game's identity is capture-triggered (5.1).

### 3.4 Level requirement and slot cost

**`minLevel`** is an integer from 1 to `CAPS.LEVEL_CAP` (30). `validateLoadout` rejects an ability
above the player's level (R-LOAD-004 rule 2, code `ability_level`). Level requirements are PLAYTEST
values tuned from telemetry (DD-05); the starter catalogue spans levels 1 to 18 (5.7), and the maximum
build must still arrive at level 25.

**`slotCost`** is an integer from 1 to `CAPS.MAX_ABILITY_CAPACITY` (5). Every starter ability costs 1.
In each ability set the total slot cost must fit the army's capacity (rule 4, `capacity_exceeded`).
Capacity is `CAPS.BASE_ABILITY_CAPACITY` (1) unless a capacity item raises it, so an expensive ability
also has an effective minimum level set by the capacity item it needs:

| `slotCost` | Needs capacity item        | Item level (7.2) | Item slot cost | Earliest level with that slot | Effective minimum level |
| ---------- | -------------------------- | ---------------- | -------------- | ----------------------------- | ----------------------- |
| 1          | none                       | —                | —              | —                             | 1                       |
| 2          | Dual Adept's Glove (2)     | 1                | 1              | 1                             | 1                       |
| 3          | Triple Adept's Gloves (3)  | 5                | 2              | 5                             | 5                       |
| 4          | Journeyman's Medallion (4) | 12               | 3              | 10                            | 12                      |
| 5          | Headmaster Ring (5)        | 20               | 4              | 15                            | 20                      |

Item slots by level (R-LOAD-001, COMMITTED): `slots = min(6, 1 + floor(level / 5))`.

| Level      | 1–4 | 5–9 | 10–14 | 15–19 | 20–24 | 25–30 |
| ---------- | --- | --- | ----- | ----- | ----- | ----- |
| Item slots | 1   | 2   | 3     | 4     | 5     | 6     |

Things to weigh when you price an ability:

- A multi-slot ability crowds out others in the same set. Under Multitasker's Schedule each of the
  six sets pays separately.
- Slot cost is public information once the ability is revealed: the Dossier proves a minimum
  capacity from the abilities seen on one piece type (`deduce.ts`), so expensive abilities leak build
  information.
- Tooling caveat: the simulator's `pickAbilities` (`apps/tools/src/sim/builds.ts`) counts abilities,
  not slot cost, so an ability with `slotCost > 1` can make an archetype build fail its validity
  check. Ask the tools owner to make it cost-aware before shipping one.

### 3.5 Eligibility

- `eligible` is `'all'` or a non-empty list of piece types. The SDK exports `NON_KING` (every type
  except king), used by Hit and Run, Momentum and Rebirth; Stalwart is `['king']`.
- An ability that is ineligible for a type does nothing on that type but still uses the slot (7.3).
  The resolver skips it when collecting triggers, and the AI's knowledge skips it too.
- Eligibility is checked against the piece's **current** type, so a promoted pawn uses its new
  type's set (R-RULES-002).
- Hooks are not filtered by eligibility. A PASSIVE ability's hooks run whenever the ability is in any
  of its side's sets, so the hook must check the piece itself (§3.10).

### 3.6 Limits, charges and Overabundance

- `limits.perAction` is always `1`: each ability instance on each piece fires at most once per
  action, nested bonus-action pipelines included (5.4).
- `limits.charges` makes the ability **consumable**: that many uses per piece per battle. Usage is
  counted per piece identity in `GameState.usage` under `` `${pieceId}:${abilityId}` ``, so a revived
  piece keeps its counters (5.4).
- A charge is spent only when at least one effect of the activation resolves; a fully fizzled,
  negated or silenced activation costs nothing (DD-17). Which primitives count as resolving is listed
  in §4.2. A consumable ability with no charges left does not trigger at all (and so is not revealed).
- Spending emits `ChargeSpent` with the charges remaining. The UI and the AI read
  `engine.remainingCharges(state, pieceId, abilityId)`.
- **Overabundance** (Grove trait, R-ELEM-007) doubles the charges of every consumable ability on a
  piece that started the battle as a Grove piece, through the `modifyCharges` hook (DD-43: fixed at
  battle start, so a promotion neither grants nor removes the doubling). Worked example E9: Rebirth
  (1 charge) returns a Grove bishop twice. A Grove-affinity consumable is doubled whenever it is
  attuned on a Grove bearer, so price it with that in mind.
- An activation spends at most one charge, even when both its immediate effects and an
  `fx.atChainEnd` effect resolve (DD-48).

### 3.7 Tags: replay, revive and Warden's Stopwatch

| Tag      | Meaning (DD-02, 5.6)                  | Required when the ability contains (base or attuned) | Current modules    |
| -------- | ------------------------------------- | ---------------------------------------------------- | ------------------ |
| `replay` | Grants a bonus move                   | `fx.bonusAction(...)`                                | Momentum, Riposte  |
| `revive` | Returns a captured piece to the board | `fx.revive(...)`                                     | Reinforce, Rebirth |

Warden's Stopwatch reads nothing but tags: its `triggerFilter` negates every trigger whose ability
carries either tag, for both players, for the whole battle (7.2, D-39 COMMITTED):

```ts
triggerFilter: (_ctx, { ability }) =>
  ability.tags.includes('replay') || ability.tags.includes('revive') ? 'negate' : 'allow',
```

`content:validate` checks tag spelling only. A bonus action or revive without its tag silently
escapes the Stopwatch, which is a rules bug. Add a Stopwatch case to the module's test; the INV-01
property test (`packages/content/test/property.test.ts`) also fails when fuzzed games show more bonus
moves than `replay`-tagged activations.

### 3.8 Trigger conditions

`conditions` gate whether the ability triggers at all. All listed conditions must hold. They are
checked when the trigger would be queued, before the trigger filters and the silence rule, using the
pieces' current types (so a promoted captor counts as its new type).

```ts
export type Condition =
  | { victimTypeNot: PieceType }
  | { victimTypeIs: PieceType[] }
  | { captorTypeIs: PieceType[] }
  | { captorTypeNot: PieceType };
```

When a condition fails the ability simply does not trigger: no event, no reveal, no charge. Compare
`fx.when` (§4.7), which is evaluated when the ability resolves: the ability has already triggered and
been revealed, and only the wrapped effects are skipped. Pick `conditions` when the ability should
stay hidden if it does not apply, and `fx.when` when the activation itself should be visible.

Reinforce (`abilities/reinforce.ts`) uses a condition and removes it in its attuned version:

```ts
conditions: [{ victimTypeNot: 'pawn' }],
effects: [fx.revive(target.mostRecentCaptured('friendly', 'pawn'), square.start())],
attuned: {
  mode: 'replace',
  conditions: [],
  effects: [fx.revive(target.mostRecentCaptured('friendly', 'pawn'), square.start())],
},
```

### 3.9 Attuned versions

An ability whose affinity matches its bearer's element uses its attuned version (6.3, R-ELEM-003).

- **When.** The ability has an `attuned` block, its affinity is not `neutral`, and either the
  bearer's element equals the affinity or an `attunement` hook says so (Attunement Charm). An item
  that attunes is revealed when the attuned trigger resolves, or already when attunement alone let
  the trigger pass its conditions. Attunement uses the bearer's element when the ability resolves
  (DD-36), so a promoted piece under Blended Family follows its new group's element.
- **`mode: 'replace'`** runs `attuned.effects` instead of `effects` (Hit and Run, Backdraft, Cleave,
  Momentum, Antidote, Rebirth, Reinforce).
- **`mode: 'append'`** runs `effects`, then `attuned.effects` (Poisoned Meat, Pierce, Scout, Last
  Word, Riposte).
- **`attuned.conditions`**, when present, replace `conditions` for an attuned bearer. Use `[]` to drop
  the base conditions (Reinforce). When absent, the base conditions apply.
- `AbilityTriggered.attuned` records which version ran.
- Neutral abilities have no attuned version; `content:validate` rejects one.
- Attunement does not protect against silence: an attuned bearer is still silenced by its foil (6.2).
- By convention the rules text ends with an `Attuned: ...` sentence describing the difference.

### 3.10 Passive abilities

A PASSIVE ability never triggers and is never silenced (6.2); it changes a rule through `hooks`
(`content:validate` requires them). Its `effects` hold a single `fx.modifyRule('<rule id>')` marker,
which documents the rule and resolves nothing. Real examples:

```ts
// abilities/stalwart.ts: the king-only rule difference is a movement hook (R-RULES-003).
effects: [fx.modifyRule('stalwart_king')],
hooks: {
  moveFilter: {
    kingMode: (ctx, king) =>
      king.side === ctx.owner && ctx.hasAbility(king, 'stalwart') ? 'stalwart' : undefined,
  },
},

// abilities/veil.ts: hide ability names for this piece type (DD-28).
effects: [fx.modifyRule('veil')],
hooks: {
  revealFilter: {
    reveal: (ctx, req) =>
      req.piece !== undefined && req.piece.side === ctx.owner && ctx.hasAbility(req.piece, 'veil')
        ? 'hide'
        : 'allow',
  },
},
```

Rules for passive hooks:

- The hook entry exists for a side whenever the ability is in **any** of that side's sets, and it
  sees both sides' pieces. Check `piece.side === ctx.owner`, `ctx.hasAbility(piece, ID)` (the
  piece's current type set) and, if `eligible` is not `'all'`, the piece type (or
  `eligibleFor(def, type)` from `@chain-theorem/rules`).
- A passive is revealed the first time its rule difference is observable (8.2). The engine does this
  for Stalwart (DD-32) and Veil (the veiled log, DD-28). Any other passive must reveal itself from a
  mutable hook; `ctx.revealSelf()` only reveals items, so name the ability explicitly:

```ts
onPieceMoved: (ctx, m) => {
  const owner = ctx.owner;
  // Hooks run for the whole side: keep to your own pieces that carry this ability.
  if (!owner || m.piece.side !== owner || !ctx.hasAbility(m.piece, ID)) return;
  // ...the rule difference just became observable, so reveal the passive (8.2):
  ctx.reveal(owner, { kind: 'ability', pieceType: m.piece.type, ability: ID }, 'observed');
},
```

## 4. Effects

Abilities are built only from the effect primitives of 5.2 (R-ABIL-002). A new primitive is an
engine change; a new ability is a content change.

### 4.1 How an activation resolves

1. **Collection** (when the trigger would be queued). For each ability id in the piece's current
   set, in order: skip it if of another category, ineligible for the piece type, already
   fired this action, failing its (attuned or base) conditions, or out of charges.
2. **Trigger filters.** An action-level NEGATE (from `fx.negate`) cancels it first. Then
   `triggerFilter` hooks run; the first `'negate'` wins. Then the silence rule (6.2, with
   `CAPS.SILENCE_SCOPE`) or a hook's `'silence'`, unless a `silenceOverride` hook allows it.
   Negated and silenced triggers emit `AbilityNegated` or `AbilitySilenced`, are revealed by name
   (8.2), never resolve and cost no charge. Negation takes precedence over silence (DD-36).
3. **Resolution.** A NEGATE registered by an earlier activation of the same capture still cancels
   it. Otherwise the engine emits `AbilityTriggered` (with `attuned`), reveals the ability on the
   bearer's piece type, runs the effect list in order, and spends a charge if at least one effect
   resolved (DD-17).
4. Each effect either **resolves**, **fizzles** (an `EffectFizzled` event with a reason, §4.10), or
   does nothing silently: a failed `fx.when`, a declined bonus action, `fx.modifyRule`, and the
   deferral step of `fx.atChainEnd`.

Effects in one list resolve in order, and each sees the board left by the previous one. An effect
capture never queues further triggers (5.4).

### 4.2 Primitive reference

| Builder                         | Does                                                                                           | Prompts                                                | Fizzle reasons                                                        | Counts as resolved (DD-17)            |
| ------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------- | ------------------------------------- |
| `fx.effectCapture(target)`      | Removes a piece as an effect capture (credited to the ability's side, DD-38)                   | With `target.chosen` (`target`)                        | `no_target`, `royal_immunity`, `inv03`, `bulwark`, `protected`, hook  | The piece was removed                 |
| `fx.negate(of, categories)`     | Cancels the `victim`'s or `captor`'s triggers of those categories for this capture             | No                                                     | —                                                                     | Always                                |
| `fx.protect(target, count = 1)` | The next `count` (or `'all'`) effect captures targeting the piece this action fizzle           | With `target.chosen` (`target`)                        | `no_body` (self off the board), `no_target`                           | The protection was registered         |
| `fx.move(piece, square)`        | Relocates a piece without capturing                                                            | `target.chosen` (`target`), `square.chosen` (`square`) | `no_body` (self), `no_target`, `occupied`, `inv03`, `burning`, hook   | The piece moved                       |
| `fx.revive(piece, square)`      | Returns a captured piece to the board                                                          | `square.chosen` (`square`)                             | `no_target`, `already_on_board`, `occupied`, `inv03`, `burning`, hook | The piece returned                    |
| `fx.bonusAction(bonus)`         | Grants one extra move inside the current action (INV-01, §4.9)                                 | `bonusMove`; Decline first when optional               | `bonus_in_bonus`, `depth_limit`, `no_body`, `no_target`               | A bonus move was made (not a decline) |
| `fx.reveal(spec)`               | Makes abilities or items public (§8)                                                           | No                                                     | `no_target` (`highestCostItem` with no items)                         | The reveal happened                   |
| `fx.modifyRule(rule, params?)`  | Passive marker; behaviour lives in hooks (§3.10)                                               | No                                                     | —                                                                     | Never                                 |
| `fx.when(cond, effects)`        | Runs `effects` only if `cond` holds at resolution (§4.7)                                       | As the wrapped effects                                 | As the wrapped effects                                                | A wrapped effect resolved             |
| `fx.atChainEnd(effects)`        | Defers `effects` until the whole chain has resolved (§4.8)                                     | As the wrapped effects, at chain end                   | As the wrapped effects                                                | Checked at chain end                  |
| `fx.revealIfSurvives(target)`   | Shorthand: `when(survives)` then reveal that piece's type set; `self`, `captor`, `victim` only | No                                                     | —                                                                     | The reveal happened                   |

Notes per primitive (the resolver is `packages/rules/src/engine/action.ts`):

- **`effectCapture`.** Resolves the target, then runs the intercepts (§4.10). Kings are never removed
  (Royal Immunity, INV-07) and are never offered as chosen targets (DD-19). The `Captured` event has
  `by: 'effect'`, `captor` = the ability's bearer (even if it is off the board) and `source` = the
  ability. Effect captures count for win conditions and format objectives (DD-38).
- **`negate`.** Registers a negation for this capture only (keyed by the capture id). Triggers of
  that piece and category that are queued later, or already queued but not yet resolved, are
  negated; triggers that already resolved are not undone. Pierce uses it in phase 2 so the victim's
  CAPTURED triggers are negated as they are queued. It "resolves" even if there is nothing to negate,
  so a consumable NEGATE always spends its charge.
- **`protect`.** Guards against effect captures only (`against: 'effectCapture'`). Protections are
  checked last among the intercepts (DD-35), so Bulwark is spent before Antidote.
- **`move`.** The destination is resolved after the piece (§4.4); INV-03 and hooks such as Hot Foot's
  `burning` check run before the piece moves. A successful move emits `PieceMoved` and calls
  `onPieceMoved` with cause `effect`; a piece with a pending Hot Foot burn that is moved off its
  square ignites it (R-ELEM-005).
- **`revive`.** Target must be off the board: use `target.self()` (Rebirth) or
  `target.mostRecentCaptured(...)` (Reinforce). `target.chosen` only offers pieces on the board, so a
  chosen revive target always fizzles (`already_on_board`, or `no_target` when nothing matches).
  Emits `PieceRevived` and calls `onPieceMoved` with `from: -1`, cause `revive`.
- **`bonusAction`.** See §4.9.
- **`reveal`.** `{ what: 'typeSet', of: 'victim' | 'captor' | 'self' }` reveals the full set of that
  piece's current type and marks the type complete. `{ what: 'items' }` reveals the opponent's full
  item list, even when it is empty (DD-40). `{ what: 'highestCostItem' }` reveals the opponent's most
  expensive item, ties broken by item id, and fizzles when there are none (DD-40). Explicit reveals
  name veiled abilities (DD-28).
- **`modifyRule`.** Never resolves; it exists so a PASSIVE ability's data documents the rule it
  changes.

### 4.3 Target selectors

| Builder                                 | Resolves to                                                                                     |
| --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `target.self()`                         | The ability's bearer, on or off the board                                                       |
| `target.captor()`                       | The piece that made the capture that triggered the ability                                      |
| `target.victim()`                       | The piece that was captured (off the board after phase 3)                                       |
| `target.chosen(filter)`                 | A piece on the board matching `filter`, chosen by the ability's owner (§4.6)                    |
| `target.mostRecentCaptured(side, type)` | The captured piece of that side (relative to the owner) and current type captured most recently |

`PieceFilter` fields:

| Field     | Meaning                                                                             |
| --------- | ----------------------------------------------------------------------------------- |
| `side`    | `'enemy'`, `'friendly'` or `'any'`, relative to the ability's owner                 |
| `types`   | Optional list of piece types (current type)                                         |
| `near`    | Optional `{ of: Anchor; pattern: 'adjacent' \| 'diagonal' \| 'orthogonal' }` (§4.5) |
| `exclude` | Optional list of `'captor'`, `'victim'`, `'self'` to leave out                      |

Patterns: `adjacent` is the eight king-step squares, `diagonal` the four diagonal neighbours,
`orthogonal` the four orthogonal neighbours. For an effect capture the options also drop kings and
any piece whose removal would leave the acting player's ordinary king in check (DD-19). Hidden
protections (Antidote, Bulwark) are never used to filter, so a chosen effect can still fizzle.

Backdraft (`abilities/backdraft.ts`) is the reference for a chosen target:

```ts
fx.effectCapture(
  target.chosen({
    side: 'enemy',
    types: ['pawn'],
    near: { of: 'self', pattern: 'adjacent' },
    exclude: ['captor'],
  }),
),
```

### 4.4 Square selectors

| Builder                 | Resolves to                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| `square.origin()`       | The square the captor moved from in the capture that triggered the ability (for every category) |
| `square.start()`        | The starting square of the piece being moved or revived (its identity's start, DD-22)           |
| `square.chosen(filter)` | An empty square matching `filter`, chosen by the ability's owner (§4.6)                         |

`SquareFilter` fields (the builder always adds `empty: true`):

| Field      | Meaning                                                              |
| ---------- | -------------------------------------------------------------------- |
| `near`     | Optional `{ of: Anchor; pattern }`: squares near the anchor          |
| `backRank` | Optional `true`: the owner's back rank                               |
| `include`  | Optional list of `'origin'`, `'start'`: always offered too, if empty |

Candidates are the empty squares that satisfy `near` and `backRank` together, plus any `include`
squares that are empty. A filter with neither `near` nor `backRank` offers only its `include`
squares. The engine then drops squares the moving piece may not enter (`moveFilter.blockedSquares`,
for example burning squares for a non-Ember piece) and squares that would leave the acting player's
ordinary king in check (INV-03). The fixed selectors `origin` and `start` are not pre-filtered: an
occupied one fizzles with `occupied`, a burning one with `burning`, an unsafe one with `inv03`.

Hit and Run (`abilities/hit_and_run.ts`) and Rebirth (`abilities/rebirth.ts`) show both forms:

```ts
effects: [fx.move(target.self(), square.origin())],
attuned: {
  mode: 'replace',
  effects: [
    fx.move(
      target.self(),
      square.chosen({ near: { of: 'origin', pattern: 'adjacent' }, include: ['origin'] }),
    ),
  ],
},

// Rebirth, attuned: any empty back-rank square, or its start square.
fx.atChainEnd([
  fx.revive(target.self(), square.chosen({ backRank: true, include: ['start'] })),
]),
```

### 4.5 Anchors and the last known square

An `Anchor` is where a `near` filter measures from: `'self'`, `'captor'`, `'victim'`, `'origin'` or
`'landing'`.

- A piece on the board anchors at its current square.
- A piece captured during **this action** anchors at the square where it was captured: its last
  known square (5.4). This is how Backdraft measures "adjacent to this square" from a fallen pawn.
- `'origin'` is the captor's from-square in the triggering capture; `'landing'` is the square it
  captured on. Unlike `'self'` or `'captor'`, both stay fixed even if a piece moves away afterwards.
- A piece captured in an earlier action has no last known square in this action, so a `near` filter
  anchored on it offers nothing and the effect fizzles with `no_target`.

Hooks see the same information as `PieceView.lastSquare`. The companion rule of 5.4, "self-acting
effects fizzle without a body", is why Hit and Run fizzles with `no_body` when Poisoned Meat has
removed the knight first (worked example E1).

### 4.6 Choices

- **Who chooses.** Always the ability's owner (5.2), including an opponent's ability during your
  action (5.4). The engine suspends the action and returns `needsChoice` with a `ChoiceRequest`
  (`kind` is `target`, `square` or `bonusMove`); only the chooser's projection carries the options.
- **Option order.** Square order a1 to h8 from the chooser's side (`relOrder`): for Black, a8 comes
  first and h1 last. Bonus moves are ordered by from-square, then to-square, then promotion piece.
- **Mandatory selections** (targets and squares, DD-18). No valid option: the effect fizzles with
  `no_target`. Exactly one: it resolves without a prompt and without a `ChoiceMade` event. Two or
  more: a prompt whose default is option 0, the first in square order.
- **Optional bonus actions** (`optional: true`, DD-18). Decline is listed first and is the default.
- **Timeouts.** The chooser has `CHOICE_PROMPT_MS` (15 s, `config.ts`) charged to their own clock; no
  answer means the default option (5.4).
- **Public filtering only** (DD-19): options are filtered by occupancy, burning squares, Royal
  Immunity and INV-03, never by hidden protections, because the option list would leak them
  (R-SEC-001). For the same reason the INV-03 filter treats the acting player's king as ordinary
  unless the chooser is that player or its Stalwart is already revealed.
- **Privacy.** The `ChoiceMade` event goes only to the chooser; the opponent sees the resulting board
  events.
- **Pre-supplied choices** (`MoveInput.choices`) are used only for the mover's own CAPTURING
  abilities in the committed action; every other choice is prompted (DD-39).
- **Replay.** A choice resumes by re-running the whole action from the pre-action snapshot with the
  answers so far (DD-11). Effects and hooks must therefore give identical results on every run; any
  hidden state outside `ctx` writes breaks the replay with a `bad_choice` error.
- **Previews and NPC search** answer every prompt with its default (`applyWithDefaults`).

### 4.7 Conditional effects (`fx.when`)

`fx.when(cond, effects)` evaluates an `EffectCondition` when the effect resolves:

| `cond` builder                   | Data                                           | Holds when                                                                              |
| -------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------- |
| `cond.survives(of)`              | `{ survives: 'captor' \| 'victim' \| 'self' }` | That piece is on the board                                                              |
| `cond.noLegalCapturerOfCaptor()` | `{ noLegalCapturerOf: 'captor' }`              | The captor is on the board and no friendly piece has a legal bonus capture of it (§4.9) |
| `cond.typeIs(of, types)`         | `{ typeIs: { of, types } }`                    | That piece's current type is in `types`                                                 |
| `cond.not(c)`                    | `{ not: c }`                                   | `c` does not hold                                                                       |
| `cond.all(...cs)`                | `{ all: cs }`                                  | Every condition holds                                                                   |

There is no `any` combinator; write `cond.not(cond.all(cond.not(a), cond.not(b)))`. A false
condition skips the wrapped effects silently: the engine emits no event for it (the `condition`
fizzle reason exists in the type but is not emitted today). Riposte's attuned fallback is the
reference:

```ts
attuned: {
  mode: 'append',
  effects: [
    fx.when(cond.all(cond.noLegalCapturerOfCaptor(), cond.typeIs('captor', ['pawn'])), [
      fx.effectCapture(target.captor()),
    ]),
  ],
},
```

### 4.8 Chain-end effects (`fx.atChainEnd`)

`fx.atChainEnd(effects)` defers `effects` until the whole depth-0 chain, every reaction and nested
bonus pipeline included, has resolved, just before Settle. Deferred effects resolve in the order
their triggers resolved (DD-22), with the same context (bearer, capture, owner), and go through the
normal intercepts and fizzles. Queuing them resolves nothing; the charge is spent when the deferred
effects resolve (DD-17). Rebirth is the pattern: a CAPTURED trigger whose revive waits until the
chain is over, so "if its starting square is empty" is judged on the final board (E9):

```ts
effects: [fx.atChainEnd([fx.revive(target.self(), square.start())])],
```

### 4.9 Bonus actions and INV-01

INV-01: one action per turn; an ability may grant at most one bonus action inside an action, and
bonus actions cannot grant further bonus actions. `fx.bonusAction(bonus)` takes a `BonusSpec`:

| Field      | Values                                            | Meaning                                                                                             |
| ---------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `movers`   | `'self'`, `'selfOrFriendlyPawn'`, `'anyFriendly'` | Who may make a non-capturing bonus move (ignored when `capture` is `'captor'`)                      |
| `capture`  | `'none'`, `'captor'`                              | `'none'`: one non-capturing move. `'captor'`: a move by any friendly piece that captures the captor |
| `optional` | `boolean`                                         | `true`: the owner may decline (DD-18); Momentum and Riposte use `true`                              |

- Bonus moves are real chess moves for the owner: they update castling rights, the en passant square
  and the 50-move counter, and a pawn reaching the last rank promotes, each promotion piece being a
  separate option (DD-31). Castling is never a bonus move; a captor capture is never en passant
  (DD-21).
- When the owner is not the acting player, a bonus move must also not leave the acting player's
  ordinary king in check (INV-03, DD-21), judged with what the owner can know (an unrevealed
  Stalwart counts as ordinary); a bonus capture that leaves a Stalwart king in check reveals it
  (DD-32).
- A capturing bonus move runs a nested pipeline at depth 1: its own CAPTURING, CAPTURED and CAPTURES
  abilities trigger normally (each still at most once per action), and a Hot Foot pending burn can
  start from it (DD-24).
- Inside a bonus action every `bonusAction` effect fizzles with `bonus_in_bonus` (DD-12), so the
  effective depth is 1; `CAPS.MAX_CHAIN_DEPTH` stays as a hard guard (`depth_limit`).
- Put at most one `fx.bonusAction` in an ability (base and attuned combined) and tag it `replay`
  (§3.7). `content:validate` checks both, and that a `revive` effect carries the `revive` tag.

### 4.10 Intercepts and fizzle reasons

Before an `effectCapture`, `move` or `revive` resolves, the engine runs the intercepts in this fixed
order (DD-35): Royal Immunity, INV-03, trait hooks (Bulwark, Hot Foot), item hooks, ability hooks,
then PROTECT registrations (Antidote). The first fizzle wins and later interceptors are not consulted,
so they are not consumed. An item whose intercept fizzles an effect is revealed.

| Reason             | Emitted when                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| `no_body`          | A self-acting effect's piece is off the board: `move(self)`, `protect(self)`, a `self` bonus move |
| `no_target`        | No target or square could be resolved: no options, target off the board, no items to reveal       |
| `occupied`         | The destination of a `move` or `revive` is occupied                                               |
| `already_on_board` | A `revive` target is on the board                                                                 |
| `royal_immunity`   | An effect capture targets a king (R-RULES-004, INV-07)                                            |
| `inv03`            | The effect would leave the acting player's ordinary king in check (INV-03)                        |
| `protected`        | A PROTECT registration absorbed an effect capture                                                 |
| `bulwark`          | Stone's Bulwark absorbed the first effect capture on that Stone piece                             |
| `burning`          | Hot Foot: a non-Ember piece would be moved or revived onto a burning square                       |
| `depth_limit`      | A nested pipeline would exceed `CAPS.MAX_CHAIN_DEPTH`                                             |
| `bonus_in_bonus`   | A bonus action was granted inside a bonus action (INV-01, DD-12)                                  |
| `condition`        | Reserved in `FizzleReason`; not emitted by the engine today                                       |

An `effectIntercept` hook may return any existing `FizzleReason`. A new reason is an engine change
(§12), and the client's log text for it lives in `apps/client/src/battle/describe.ts`.

## 5. Item modules

Items are equipped into item slots and change capacity, elements or army rules. They have no effect
list: they act through data flags that the loadout validator reads, and through hooks.

### 5.1 Anatomy

`packages/content/items/wardens_stopwatch.ts` is the 13.5 example, verbatim:

```ts
/**
 * Warden's Stopwatch (R-LOAD-002, D-39 COMMITTED; min level PLAYTEST).
 * Negates every replay and revive ability, for both players, for the whole battle.
 */
import { defineItem } from '@chain-theorem/rules/sdk';

export default defineItem({
  id: 'wardens_stopwatch',
  name: "Warden's Stopwatch",
  version: 1,
  slotCost: 1,
  minLevel: 18,
  hooks: {
    // Both players: negate every replay and revive trigger for the whole battle.
    triggerFilter: (_ctx, { ability }) =>
      ability.tags.includes('replay') || ability.tags.includes('revive') ? 'negate' : 'allow',
  },
  text: {
    short: 'No replays or revivals, for both sides.',
    rules: 'Negates every replay and revive ability, for both players, for the whole battle.',
  },
  status: 'COMMITTED',
});
```

`items/resonance_crystal.ts` shows a one-sided item with private state and an explicit reveal
(annotations added):

```ts
export interface ResonanceState {
  // One slice per module, shared by both sides: key per-side data by Side.
  used: Record<Side, { capture: number; piece: number } | null>;
}
const ID = 'resonance_crystal';

export default defineItem({
  id: ID,
  name: 'Resonance Crystal',
  version: 1,
  slotCost: 1,
  minLevel: 6,
  hooks: {
    // No `project`: the slice is private and never sent to a client.
    stateSlice: { id: ID, init: (): ResonanceState => ({ used: { white: null, black: null } }) },
    silenceOverride: (ctx, t) => {
      const owner = ctx.owner;
      if (!owner || t.side !== owner) return false; // only the owner's pieces
      const s = ctx.slice<ResonanceState>(ID);
      const used = s.used[owner];
      if (used === null) {
        // Replace the slice with a new value; never mutate `s`.
        ctx.setSlice<ResonanceState>({
          used: { ...s.used, [owner]: { capture: t.capture.id, piece: t.piece.id } },
        });
        ctx.revealSelf('observed'); // its effect is now observable (8.2, DD-30)
        return true;
      }
      return used.capture === t.capture.id && used.piece === t.piece.id;
    },
  },
  text: {
    short: 'Your first silence this battle does not happen.',
    rules: 'The first time one of your pieces would be silenced this battle, it is not.',
  },
  status: 'PLAYTEST',
});
```

### 5.2 Fields and validation

| Field            | Type                                           | content:validate                                                              | Also enforced or read by                                              |
| ---------------- | ---------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `id`             | `string`                                       | Unique among items; snake_case; matches a file name in `items/`               | `createEngine` duplicate check; `content:new`                         |
| `name`           | `string`                                       | —                                                                             | Client, validator messages                                            |
| `version`        | `number`                                       | — (use a positive integer)                                                    | `CONTENT_VERSION`                                                     |
| `slotCost`       | `1 \| 2 \| 3 \| 4`                             | 1 to 4; a capacity item costs `capacity − 1`; every other item costs 1 (D-22) | `validateLoadout` rule 1 (`slots_exceeded`); Dossier enumeration      |
| `minLevel`       | `number`                                       | Integer in 1..`CAPS.LEVEL_CAP` (30)                                           | `validateLoadout` rule 2 (`item_level`); Dossier                      |
| `capacity`       | `2 \| 3 \| 4 \| 5` (optional)                  | At most `CAPS.MAX_ABILITY_CAPACITY`; requires `exclusiveGroup: 'capacity'`    | `loadoutShape` (capacity); rule 4                                     |
| `exclusiveGroup` | `string` (optional)                            | `'capacity'` for capacity items                                               | `validateLoadout` rule 3 (`exclusive_group`); Dossier                 |
| `grants`         | `{ perTypeSets?: true; secondElement?: true }` | —                                                                             | Rule 5 (`set_count`), rule 6 (`elements_*`); Dossier (DD-13)          |
| `param`          | `{ element: 'required' }` (optional)           | —                                                                             | Rule 7 (`item_param`): `itemParams[id].element` in `ENABLED_ELEMENTS` |
| `hooks`          | `Partial<RuleHooks>`                           | — (required by the type; `{}` for data-only items)                            | Hook runner (§7)                                                      |
| `text`           | `{ short; rules }`                             | Both non-blank                                                                | Client                                                                |
| `status`         | `Status`                                       | One of the three                                                              | §11                                                                   |
| `retired`        | `boolean` (optional)                           | —                                                                             | Rule 7 (`retired`); Dossier and fuzzer skip it                        |
| _test file_      | —                                              | `items/<id>.test.ts` with an `it(` or `test(` call                            | Vitest                                                                |

Level and slot guidance: items outside the capacity group always cost 1 slot, and a level 1–4 player
has one slot, so an item's `minLevel` is its real gate. Capacity items cost N − 1 slots for capacity
N and never stack (7.2). The item catalogue must keep the Flexible and Focused builds competitive with
Maximum (7.3); check new utility items with `pnpm sim`.

`validateLoadout` (R-LOAD-004, INVARIANT at battle start) reports these codes; all limits come from
CAPS and module data:

| Rule | Codes                                                                      |
| ---- | -------------------------------------------------------------------------- |
| 1    | `slots_exceeded`                                                           |
| 2    | `item_level`, `ability_level`, `bad_level` (level not an integer in 1..30) |
| 3    | `exclusive_group`, `duplicate_item`                                        |
| 4    | `capacity_exceeded`, `duplicate_ability`                                   |
| 5    | `set_count`                                                                |
| 6    | `elements_count`, `elements_same`, `element_disabled`                      |
| 7    | `not_owned`, `retired`, `unknown_item`, `unknown_ability`, `item_param`    |

### 5.3 Loadout-shaping items

Items that change the loadout's shape declare data, not code (DD-13), so the validator never needs an
item id:

- **Capacity:** `capacity: N`, `slotCost: N − 1`, `exclusiveGroup: 'capacity'`, `hooks: {}` (Dual
  Adept's Glove, Triple Adept's Gloves, Journeyman's Medallion, Headmaster Ring).
- **Per-type sets:** `grants: { perTypeSets: true }` allows 6 sets (Multitasker's Schedule).
- **Second element:** `grants: { secondElement: true }` requires two different elements (Blended
  Family).
- **Element parameter:** `param: { element: 'required' }` makes the loadout carry
  `itemParams[id].element`; read it with `ctx.itemParam(side, id)` (Attunement Charm, Masquerade
  Mask; one module covers every element, DD-29).

```ts
// items/dual_adepts_glove.ts
export default defineItem({
  id: 'dual_adepts_glove',
  name: "Dual Adept's Glove",
  version: 1,
  slotCost: 1,
  minLevel: 1,
  capacity: 2,
  exclusiveGroup: 'capacity',
  hooks: {},
  text: {
    short: 'Ability capacity 2.',
    rules: 'Each piece type may hold up to 2 ability slots. Capacity items never stack.',
  },
  status: 'COMMITTED',
});
```

### 5.4 Items with hooks

- An item's hooks run once for **each side that equips it**, with `ctx.owner` set to that side, and
  they see both sides' pieces, triggers and effects. Check `piece.side === ctx.owner` (or
  `t.side === ctx.owner`) unless the item is deliberately two-sided like Warden's Stopwatch. If both
  players equip the same item, its hooks run twice, once per owner.
- The engine reveals an item automatically when its `triggerFilter` negates a trigger, its
  `effectIntercept` fizzles an effect, or its `attunement` hook attunes a trigger (§3.9). Any other
  hook must
  call `ctx.revealSelf()` when its effect becomes observable (8.2): Scout's Lens, Resonance Crystal
  and Masquerade Mask do.
- `state.armies[side].loadout.items` is readable in hooks because hooks run on the true state; never
  copy what you read there into anything public (§8).
- The Dossier (`deduce.ts`) enumerates item combinations from `slotCost`, `minLevel`, `capacity`,
  `exclusiveGroup` and `grants`, and treats any item with a `revealFilter.element` hook as one that can
  disguise the displayed elements. New items take part automatically.

Scout's Lens (`items/scouts_lens.ts`) shows `onBattleStart` and an explicit reveal with a source:

```ts
onBattleStart: (ctx) => {
  const owner = ctx.owner;
  if (!owner) return;
  const opp = owner === 'white' ? 'black' : 'white';
  const first = ctx.state.armies[opp].sets.pawn[0];
  ctx.revealSelf('observed');
  if (first) {
    ctx.reveal(opp, { kind: 'ability', pieceType: 'pawn', ability: first }, 'effect', {
      kind: 'item',
      id: 'scouts_lens',
      side: owner,
    });
  }
},
```

## 6. Trait modules

An element trait is an always-on rule (6.1, R-ELEM-001). Traits are not abilities: they use no slots,
have no level requirement, are never silenced and apply per piece, so they work unchanged under
Blended Family.

| Field     | Type                 | content:validate                                      |
| --------- | -------------------- | ----------------------------------------------------- |
| `id`      | `string`             | Unique among traits; matches a file name in `traits/` |
| `name`    | `string`             | —                                                     |
| `element` | `ElementId`          | One of the six elements (not `neutral`)               |
| `version` | `number`             | —                                                     |
| `hooks`   | `Partial<RuleHooks>` | —                                                     |
| `text`    | `{ short; rules }`   | Both non-blank                                        |
| `status`  | `Status`             | One of the three                                      |

- **Exactly one trait per element.** `content:validate` fails unless each of the six elements has
  exactly one trait module, and all six exist (Hot Foot, Flow, Overabundance, Always First, Bulwark,
  Stillness). The six traits are COMMITTED (6.1), so changing one needs designer approval; bump its
  `version` when you do.
- `pnpm content:new trait <id>` writes `element: 'ember'`; since every element already has its trait,
  a new trait replaces its element's module (delete the old file). Traits have no `retired` flag.
- Trait hooks always run, in every battle, with `ctx.owner === null`, and see every piece of both
  sides. Check the element yourself (`piece.element`, `t.capture.victim.element`, `t.element`).
- Traits are public knowledge: no reveals are needed, and events they cause carry a
  `{ kind: 'trait', id, element }` source.

Stillness (`traits/stillness.ts`) is a complete trait in one hook:

```ts
export default defineTrait({
  id: 'stillness',
  name: 'Stillness',
  element: 'frost',
  version: 1,
  hooks: {
    triggerFilter: (_ctx, t) =>
      t.category === 'CAPTURES' &&
      t.piece.id === t.capture.captor.id &&
      t.capture.victim.element === 'frost'
        ? 'negate'
        : 'allow',
  },
  text: {
    short: "Its captor's After-capturing abilities are negated.",
    rules:
      'A piece that captures your Frost piece has its Captures abilities negated for that capture.',
  },
  status: 'COMMITTED',
});
```

Hot Foot (`traits/hot_foot.ts`) is the most complete hook user in the repository: a public, hashed
state slice, `moveFilter.blockedSquares`, `effectIntercept`, `onPieceMoved`, `onEvent` and
`onTurnEnd`. Read it before writing any stateful module.

## 7. Hooks

Modules change rules only through hooks (13.5). Hooks are pure functions; the set is 13.5's table
plus the DD-14 additions (`silenceOverride`, `modifyCharges`, `attunement`, `onEvent`, and the split
of `moveFilter` into `passThrough`, `blockedSquares` and `kingMode`). The type is `RuleHooks` in
`packages/rules/src/sdk/types.ts`; modules declare `Partial<RuleHooks>`.

### 7.1 Order and owners

Hooks run in a fixed order: engine invariants first, then traits, items and abilities, each sorted by
`hooks.priority` (default 0, lower first), then by id, then by owning side (13.5).

| Module kind       | Its hook entry exists                                                  | `ctx.owner` | Sees                                                                |
| ----------------- | ---------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------- |
| Trait             | In every battle                                                        | `null`      | Every piece of both sides; check elements                           |
| Item              | Once per side that equips it                                           | That side   | Everything; check `side === ctx.owner` unless two-sided             |
| Ability (`hooks`) | Once per side whose sets contain it on any piece type, eligible or not | That side   | Everything; check side, `ctx.hasAbility(piece, ID)` and eligibility |

"Engine invariants first" means: for `triggerFilter`, action-level NEGATEs are applied before any
hook, and the silence rule after them; for `effectIntercept`, Royal Immunity and INV-03 run before any
hook and PROTECT registrations after them (DD-35).

### 7.2 Contexts

Every hook receives a context. Read-only hooks get a `ReadCtx`; hooks that may change state get a
`MutCtx` (`SetupCtx` is the same type).

| `ReadCtx` member        | Returns                                                                         |
| ----------------------- | ------------------------------------------------------------------------------- |
| `state`                 | `Readonly<GameState>`: the true state, hidden data included. Never mutate it    |
| `caps`, `registry`      | The engine's `Caps` and `ContentRegistry`                                       |
| `owner`                 | The equipping side for items and abilities; `null` for traits and slice init    |
| `piece(id)`             | A `PieceView` (on or off the board)                                             |
| `pieceAt(square)`       | The `PieceView` on a square, or `null`                                          |
| `pieces(side?)`         | Pieces on the board, optionally of one side                                     |
| `slice<T>(id?)`         | A state slice; defaults to this module's own                                    |
| `abilitiesOf(piece)`    | Ability ids of the piece's current type set, in order, ineligible ones included |
| `hasAbility(piece, id)` | Whether that set contains the id                                                |
| `hasItem(side, id)`     | Whether that side equips the item                                               |
| `itemParam(side, id)`   | The item's loadout parameter, e.g. `{ element: 'tide' }`                        |

| `MutCtx` adds                        | Does                                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `setSlice<T>(value, id?)`            | Replaces a slice (§7.3)                                                                           |
| `emit(event)`                        | Appends an event. It describes; it never changes state. Only emit existing kinds with public data |
| `reveal(side, info, cause, source?)` | Makes something about `side` public (§8)                                                          |
| `revealSelf(cause = 'observed')`     | Reveals this **item** to its owner's opponent; does nothing for abilities and traits              |

`PieceView` is `{ id, side, type, element, square, lastSquare, start }`, with `square === -1` for a
captured piece and `lastSquare` its last known square (§4.5).

### 7.3 State slices

A module that needs memory declares a state slice. Slices live in `GameState.slices`, are stored with
the battle, and are hashed for repetition by default.

```ts
stateSlice: {
  id: string; // use the module id; a duplicate slice id makes createEngine throw
  init(ctx: ReadCtx): unknown; // initial value
  project?(value: unknown, viewer: Side, ctx: ReadCtx): unknown; // omit to keep it private
  hash?: boolean; // include in the repetition hash (default true, DD-33)
};
```

- **Immutable values.** Read with `ctx.slice<T>()`, build a new object, write it with
  `ctx.setSlice(next)`. Never mutate the object you read: a state clone copies the slice record
  shallowly, so the same value is shared with the pre-action snapshot used to replay choices (DD-11)
  and with earlier states held by the server. Mutating it in place breaks determinism (INV-04). Bulwark
  (`traits/bulwark.ts`) is the minimal example:
  `ctx.setSlice<BulwarkState>({ spent: [...s.spent, eff.target.id] })`.
- **Plain JSON only.** No `Map`, `Set`, class instances, functions or `undefined` values: the state is
  serialized, stored in a Durable Object and hashed from canonical JSON (DD-34).
- **One slice per module, shared by both sides.** Key per-side data by `Side` (Resonance Crystal,
  Masquerade Mask).
- **`init` runs for every module in the registry that declares a slice, whether or not anyone
  equips it**, once per battle, with `ctx.owner === null`. Compute per-side values with
  `ctx.hasItem(side, ID)`, as Masquerade Mask does. `init` also runs when a preview or NPC belief
  state is built for any slice that is not projected.
- **`project`** decides what a viewer sees. Omit it to keep the slice private (never projected).
  Return the value unchanged only when all of it is public (Hot Foot's burning squares, Bulwark's
  spent list). A projected slice reaches `PublicState.slices` and the belief states used by previews
  and NPCs; a private slice is re-initialised there, so previews and NPCs assume its initial value.
- **`hash: false`** only for bookkeeping that can never change legal play; by default slices are part
  of the threefold-repetition hash (DD-33).
- Export the slice type (`export interface ResonanceState`) so tests can read
  `state.slices[id]` with a type.

### 7.4 Hook reference

| Hook                        | Context   | Runs                                                                                                                                                                                | Returns / may write                                                                                          | Used by                          |
| --------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| `priority`                  | —         | —                                                                                                                                                                                   | Number; lower runs first within its module kind                                                              | —                                |
| `stateSlice`                | `ReadCtx` | `init` once per battle; `project` per projection                                                                                                                                    | See §7.3                                                                                                     | Hot Foot, Bulwark, Mask, Crystal |
| `onBattleStart`             | `MutCtx`  | Once, after slices are initialised and `BattleStarted` is emitted                                                                                                                   | `void`; may set slices, emit, reveal                                                                         | Scout's Lens                     |
| `moveFilter.passThrough`    | `ReadCtx` | For each piece on the board whenever movement rules are built                                                                                                                       | `true`: the piece treats its own side's pieces as empty while moving or attacking through them               | Flow                             |
| `moveFilter.blockedSquares` | `ReadCtx` | Same                                                                                                                                                                                | Squares the piece may not move to or capture on; also removed from chosen squares for effects on that piece  | Hot Foot                         |
| `moveFilter.kingMode`       | `ReadCtx` | Same, kings only                                                                                                                                                                    | `'stalwart'` gives the king Stalwart rules; the engine handles its reveal (DD-32)                            | Stalwart                         |
| `queueOrder`                | `ReadCtx` | Phase 4, before the reaction queue resolves, when it holds two or more triggers                                                                                                     | A permutation of the queue (anything else is ignored); hooks chain                                           | Always First                     |
| `triggerFilter`             | `MutCtx`  | Once per trigger when it is queued (phase 2 for CAPTURING, phase 4 for reactions)                                                                                                   | `'allow'`, `'silence'` or `'negate'` (first `'negate'` wins; a negating item is revealed)                    | Stillness, Warden's Stopwatch    |
| `silenceOverride`           | `MutCtx`  | Only when a trigger would be silenced (element rule or a hook's `'silence'`); never for negations                                                                                   | `true` keeps it unsilenced (first `true` wins). No automatic reveal: call `revealSelf`                       | Resonance Crystal                |
| `effectIntercept`           | `MutCtx`  | Before an `effectCapture`, `move` or `revive` resolves (§4.10)                                                                                                                      | `'allow'` or `{ fizzle: FizzleReason }` (first fizzle wins; a fizzling item is revealed)                     | Bulwark, Hot Foot                |
| `onPieceMoved`              | `MutCtx`  | After a piece lands: cause `move`, `castle` (king and rook), `bonus`, `effect` or `revive` (`from: -1`)                                                                             | `void`. Not called when a piece is captured: use `onEvent` for `Captured`                                    | Hot Foot                         |
| `onTurnEnd`                 | `MutCtx`  | In Settle, after the turn passes and before `TurnPassed` and adjudication; `side` is the player who just acted. Also on throwaway drafts, to judge king safety as the turn will end | `void`; changes count for checkmate and stalemate (DD-25)                                                    | Hot Foot countdown               |
| `revealFilter.reveal`       | `ReadCtx` | When an ability would be revealed because it activated, was silenced or was negated                                                                                                 | `'hide'` keeps the name hidden and reveals the piece type as veiled; explicit and observed reveals bypass it | Veil                             |
| `revealFilter.element`      | `ReadCtx` | While projecting, for the viewer's opponent's pieces, army elements and `Promoted` events                                                                                           | The element to display, or `undefined`                                                                       | Masquerade Mask                  |
| `modifyCharges`             | `ReadCtx` | Whenever charges are counted (collection, `ChargeSpent`, `remainingCharges`)                                                                                                        | The new maximum; hooks chain                                                                                 | Overabundance                    |
| `attunement`                | `ReadCtx` | When an ability with an attuned version is checked on a piece whose element does not match                                                                                          | `true` counts it as attuned (first `true` wins; the item is revealed as described in §3.9)                   | Attunement Charm                 |
| `onEvent`                   | `MutCtx`  | After every emitted event: setup, actions, battle end and events emitted by hooks (nested up to 4 levels)                                                                           | `void`                                                                                                       | Masquerade Mask, Hot Foot        |

General rules:

- Read-only hooks (`ReadCtx`) run during move generation, INV-03 simulations, projections, previews
  and NPC search, often many times per move. Keep them cheap, and never try to write from them.
- Hooks may run on **drafts**: INV-03 checks apply a change to a copy of the state and rebuild the
  movement rules there, and legal-move generation runs `onTurnEnd` on a copy to see which rules
  (for example a burn about to expire) will hold once the turn ends. Anything written there is thrown
  away, so a hook must affect the game only through `ctx`. Avoid calling `setSlice` when nothing
  changed: a new slice value makes the engine rebuild the movement rules.
- Hooks must be total and deterministic: return `'allow'`, `undefined`, `false` or the input when the
  hook does not apply, and never throw.
- The hook payload types are `TriggerInfo` (`piece`, `side`, `ability`, `category`, `capture`,
  `element`, `otherElement`: the last two are the commit-time elements used for silence),
  `QueuedTrigger`, `EffectInfo` (`kind`, `target`, `to`, `source`, `sourceSide`, `actor`),
  `PieceMovedInfo` (`piece`, `from`, `to`, `cause`, `capture`, `depth`) and `RevealRequest`.

## 8. Hidden information and reveals

Players start a battle knowing only the opponent's level, element(s) and consumed item slots (8.1,
R-INFO-001) and learn the rest by watching abilities fire. The server holds the full state and sends
each player a projection (R-INFO-005, INVARIANT); it never sends an opponent's unrevealed loadout
(R-SEC-001). Your module runs on the full state, so it must not undo that.

**What the engine does for you**

- A triggered ability is revealed, with the piece type it was seen on, when it activates, is silenced
  or is negated (8.2). The piece type is the one whose set produced the trigger, so a promotion later
  in the same action does not change it. Veil turns these into "this type is veiled" (DD-28).
- `projectEvents` hides what the viewer has not seen. For an unrevealed opponent ability,
  `AbilityTriggered`, `AbilitySilenced` and `AbilityNegated` lose their ability id, category and
  attuned flag; its `EffectFizzled` and `ChargeSpent` events are not sent at all; `ChoiceMade` goes
  only to the chooser; and the `source` of `AbilityNegated`, `EffectFizzled`, `Captured`,
  `PieceMoved`, `PieceRevived` and `Revealed` becomes `{ kind: 'hidden' }`. Opponent usage counters
  are projected only for revealed abilities.
- Items are revealed when their `triggerFilter` negates, their `effectIntercept` fizzles or their
  `attunement` hook attunes a trigger. Stalwart is revealed when its difference is observable (DD-32).
- Choice options go only to the chooser; state slices are private unless they declare `project`.

**What your module must do**

- Reveal items and passives when their effect becomes observable: `ctx.revealSelf()` for items,
  `ctx.reveal(owner, { kind: 'ability', ... }, 'observed')` for passives (§3.10).
- Use `fx.reveal` (or `ctx.reveal`) for deliberate information effects. `ctx.reveal(side, ...)`
  reveals something **about** `side` to its opponent.
- Never put an unrevealed ability or item id where the projection does not mask it: events you
  `emit` pass through `projectEvents` unchanged unless they are one of the kinds above, and a
  projected slice is sent as your `project` returns it.
- Filter choice options by public facts only (DD-19).
- Remember what the rest of the system infers from data: slot costs feed the Dossier's capacity
  proofs, and items with `revealFilter.element` are treated as possible disguises.

| `RevealInfo` kind | Payload                  | Effect on the reveal log                   |
| ----------------- | ------------------------ | ------------------------------------------ |
| `ability`         | `pieceType`, `ability`   | Adds the ability to that type's known list |
| `set`             | `pieceType`, `abilities` | Adds them and marks the type complete      |
| `item`            | `item`                   | Adds the item                              |
| `items`           | `items`                  | Adds them and marks the item list complete |
| `veiled`          | `pieceType`              | Marks the type as veiled                   |
| `elements`        | `elements`               | Event only (Masquerade Mask dropping)      |

`RevealCause` is one of `activated`, `silenced`, `negated`, `fizzled`, `effect` (explicit reveals,
which name veiled abilities) and `observed` (rule differences and items).

**How it is checked.** The fuzzer serializes every projection and projected event of every quick
fuzz game and fails if any string equals an unrevealed opponent ability or item id (R-SEC-001;
`apps/tools/src/fuzz/game.ts`). Add your own projection assertion too (§9).

## 9. Testing with scenario()

Every module has a test file next to it (`abilities/<id>.test.ts`, `items/<id>.test.ts`,
`traits/<id>.test.ts`); `content:validate` requires at least one `it(` or `test(` call in it. Test
names include requirement IDs (CLAUDE.md, 17.1), for example `R-ABIL-005` (module data), `R-ABIL-001`
to `R-ABIL-004` (timing, primitives, pipeline, resolution rules), `R-ELEM-002` (silence), `R-ELEM-003`
(attuned), `R-ELEM-007` (Overabundance), `R-LOAD-002` and `R-LOAD-004` (items and validation),
`R-INFO-002` (reveals), `R-INFO-005` and `R-SEC-001` (projection), `INV-01` to `INV-07`, and the DD rows
your module relies on. The repository's tests open with a header saying their expected behaviour
comes from the spec, not from the engine's current output; write expectations from the rules text
first.

`packages/content/src/testing.ts` (also exported as `@chain-theorem/content/testing`) provides:

| Helper                                | Does                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `scenario(spec)`                      | Starts a battle, plays `moves`, answers prompts, and returns the result                                |
| `setup(spec)`                         | Starts a battle without moves; returns `{ engine, state, events }` (setup events such as Scout's Lens) |
| `play(engine, state, uci, answers?)`  | Applies one move and answers its prompts                                                               |
| `idAt(state, 'e4')`, `pieceAt(...)`   | The piece id or `PieceState` on a named square                                                         |
| `eventsOf(events, 'Captured')`        | Events of one kind, typed                                                                              |
| `parseSquare('e4')`, `loadoutOf(...)` | Square index; the `Loadout` an `ArmySpec` produces                                                     |

`ScenarioSpec` fields: `fen` (default: the standard start), `format` (default `'full'`), `white` and
`black` (`ArmySpec`), `caps` (overrides, e.g. `{ SILENCE_SCOPE: 'OFF' }`), `moves` (UCI strings played
by the side to move) and `answers` (consumed in order by prompts; each is an option index, a
`ChoiceOption`, or a function of the request; a missing answer takes the prompt's default).
`ArmySpec` fields: `level` (default 30), `elements` (default `['neutral']`), `items`, `itemParams`,
`sets` (one or six) or `abilities` (shorthand for one army-wide set). `ScenarioResult` has `engine`,
`initial`, `state`, `events`, `setupEvents`, `steps` (per move: `uci`, `side`, `events`, `prompts`),
`prompts` and `kinds`.

Scenarios bypass loadout validation on purpose, so they can use `neutral` elements and any ability
mix (DD-23): they call `newBattle` without `BattleSetup.strict`. With `strict: true`, meant for
every real battle, `newBattle` validates both loadouts (R-LOAD-004) and throws `bad_setup` on any
error. Test level and slot rules with `engine.validateLoadout` directly, as
`items/scouts_lens.test.ts` does:

```ts
it('R-LOAD-002 R-LOAD-004 the Lens validates at level 3 and is rejected at level 2 (rule 2)', () => {
  const l: Loadout = { elements: ['tide'], items: [ID], sets: [['scout']] };
  expect(engine.validateLoadout(l, { level: 3 }).errors).toEqual([]);
  const v = engine.validateLoadout(l, { level: 2 });
  expect(v.ok).toBe(false);
  expect(v.errors).toContainEqual(
    expect.objectContaining({ rule: 2, code: 'item_level', ref: ID }),
  );
});
```

**What to cover**

- The data: level requirement, slot cost, charges, tags.
- The base effect on the happy path, with the exact events and final squares.
- The attuned version (bearer of the affinity element; for items, Attunement Charm where relevant).
- Every fizzle reason your effects can produce, and loadout order against the other abilities in the
  same category.
- Silence in the direction that affects your category, and negation (Pierce against CAPTURED,
  Stillness against CAPTURES).
- Choices: chooser, option order, default option, single-option auto-resolution, decline.
- Charges: spending, running out, no spend on fizzle (DD-17), Overabundance on a Grove bearer.
- `replay`/`revive`: Warden's Stopwatch negates it.
- Pieces moving or disappearing: Royal Immunity, INV-03, Hot Foot burning squares, Bulwark, Antidote.
- Reveals and projection: the opponent's projection does not contain your id before it fires; after
  it fires the reveal log holds it on the right piece type.

**Golden tests and the Scenario Lab.** `packages/content/test/golden.test.ts` snapshots the worked
examples E1–E9 (5.5); a new module should not change them, and a change there is a rules change
(§11). In development builds (`pnpm --filter @chain-theorem/client dev`), the Scenario Lab at
`#/lab` loads any FEN, JSON armies, UCI moves and answers, so you can step through your chain
visually.

## 10. Worked example: adding an ability end to end

A hypothetical ability, **Backwash** (Captured, Tide, all, level 7, 1 slot): "When captured, move the
captor back to the square it moved from, if empty. Attuned: you may instead place it on any empty
square adjacent to that square." It is not in the registry; the module and test below were
type-checked and run against the engine while writing this guide.

**Step 1: scaffold.** `pnpm content:new ability backwash` prints the two files it created and
`next: fill in the data, write the test, pnpm content:index && pnpm check`.

**Step 2: fill in the data** (`packages/content/abilities/backwash.ts`). Every piece exists already:
`fx.move`, `target.captor()`, `square.origin()` and `square.chosen(...)`.

```ts
/**
 * Backwash (PLAYTEST): Captured, Tide, all. Move the captor back to the square it moved from, if
 * empty. Attuned: may instead place it on any empty square adjacent to that square.
 */
import { defineAbility, fx, square, target } from '@chain-theorem/rules/sdk';

export default defineAbility({
  id: 'backwash',
  name: 'Backwash',
  version: 1,
  category: 'CAPTURED',
  affinity: 'tide',
  eligible: 'all',
  tags: [],
  minLevel: 7,
  slotCost: 1,
  limits: { perAction: 1 },
  effects: [fx.move(target.captor(), square.origin())],
  attuned: {
    mode: 'replace',
    effects: [
      fx.move(
        target.captor(),
        square.chosen({ near: { of: 'origin', pattern: 'adjacent' }, include: ['origin'] }),
      ),
    ],
  },
  text: {
    short: 'Drags its captor back.',
    rules:
      'When captured, move the captor back to the square it moved from, if empty. Attuned: you may instead place it on any empty square adjacent to that square.',
  },
  status: 'PLAYTEST',
});
```

**Step 3: no engine change needed.** It moves a piece (MOVE) to a square named by existing selectors.

**Step 4: write the scenario test** (`packages/content/abilities/backwash.test.ts`):

```ts
/**
 * Backwash scenario tests. Expected behaviour comes from the rules text, spec 5.4, 6.2, 6.3 and 8.2,
 * not from the engine's current output.
 */
import { describe, expect, it } from 'vitest';
import { abilityById } from '../index.ts';
import { eventsOf, idAt, parseSquare, pieceAt, scenario } from '../src/testing.ts';

const sq = parseSquare;
// White knight c3 takes a black pawn on d5; kings on e1 and e8.
const FEN = '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1';

describe('backwash (R-ABIL-005)', () => {
  it('R-ABIL-005 Backwash costs 1 ability slot at level 7 and is not consumable', () => {
    const def = abilityById.get('backwash');
    expect(def?.slotCost).toBe(1);
    expect(def?.minLevel).toBe(7);
    expect(def?.limits.charges).toBeUndefined();
  });

  it('R-ABIL-001 R-INFO-002 when captured, the captor is moved back to its origin and Backwash is revealed', () => {
    const r = scenario({
      fen: FEN,
      black: { abilities: ['backwash'] },
      moves: ['c3d5'],
    });
    const knight = idAt(r.initial, 'c3');
    expect(eventsOf(r.events, 'AbilityTriggered').map((e) => e.ability)).toEqual(['backwash']);
    expect(eventsOf(r.events, 'PieceMoved')).toEqual([
      expect.objectContaining({ piece: knight, from: sq('d5'), to: sq('c3') }),
    ]);
    expect(pieceAt(r.state, 'c3')?.id).toBe(knight);
    expect(r.state.reveals.black.abilities.pawn).toEqual(['backwash']);
  });

  it('R-ABIL-004 loadout order: Poisoned Meat removes the captor first, so Backwash fizzles (no target)', () => {
    const r = scenario({
      fen: FEN,
      black: { abilities: ['poisoned_meat', 'backwash'] },
      moves: ['c3d5'],
    });
    expect(eventsOf(r.events, 'EffectFizzled')).toEqual([
      expect.objectContaining({ ability: 'backwash', effect: 'move', reason: 'no_target' }),
    ]);
    expect(pieceAt(r.state, 'c3')).toBeUndefined();
    expect(pieceAt(r.state, 'd5')).toBeUndefined();
  });

  it('R-ELEM-003 attuned: the owner picks the square, offered in square order from their side', () => {
    const r = scenario({
      fen: FEN,
      black: { elements: ['tide'], abilities: ['backwash'] },
      moves: ['c3d5'],
      answers: [{ kind: 'square', square: sq('d4') }],
    });
    expect(r.prompts).toHaveLength(1);
    expect(r.prompts[0]?.chooser).toBe('black');
    expect(r.prompts[0]?.options[0]).toEqual({ kind: 'square', square: sq('b4') });
    expect(eventsOf(r.events, 'AbilityTriggered')[0]?.attuned).toBe(true);
    expect(pieceAt(r.state, 'd4')?.id).toBe(idAt(r.initial, 'c3'));
  });

  it('R-ELEM-002 a Grove captor silences Backwash on a Tide victim, and the silence reveals it', () => {
    const r = scenario({
      fen: FEN,
      white: { elements: ['grove'] },
      black: { elements: ['tide'], abilities: ['backwash'] },
      moves: ['c3d5'],
    });
    expect(eventsOf(r.events, 'AbilitySilenced').map((e) => e.ability)).toEqual(['backwash']);
    expect(eventsOf(r.events, 'PieceMoved')).toEqual([]);
    expect(r.state.reveals.black.abilities.pawn).toEqual(['backwash']);
  });

  it('R-INFO-005 R-SEC-001 before it fires, White’s projection never names Backwash', () => {
    const r = scenario({ fen: FEN, black: { abilities: ['backwash'] } });
    expect(JSON.stringify(r.engine.project(r.state, 'white'))).not.toContain('backwash');
  });
});
```

Note the attuned prompt: Black chooses, so the options run from Black's side of the board and the
default (option 0) is b4, not the origin square c3. The Poisoned Meat case uses two abilities with
capacity 1; that is fine because scenarios skip loadout validation (DD-23).

**Step 5: register.** `pnpm content:index` (prints `content:index written: 15 abilities, ...`).

**Step 6: check.** `pnpm content:validate`, then `pnpm check`. The diff is `abilities/backwash.ts`,
`abilities/backwash.test.ts` and `registry.generated.ts`, nothing else.

**Step 7: think about the NPCs** (§13). Backwash uses `fx.move`, which has no ability profile
flag, so NPC search values it only at the root move; and its attuned prompt moves the captor rather
than its bearer, which the NPC's `square` heuristic does not model. Both are acceptable for a
PLAYTEST ability, but mention them to the AI owner.

## 11. Versions, status and retirement

- **`version`** is a positive integer. Bump it whenever the module's behaviour can change a battle:
  effects, hooks, conditions, charges, eligibility, tags, category, slot cost or level. Text-only
  fixes do not need a bump. The version feeds `CONTENT_VERSION`, recorded in every battle.
- **Changing shipped behaviour** is a rules change. If a golden or replay test changes outcome, that
  needs a register update (17.1): log a DD row for delegated decisions (§12) and update the
  snapshot in the same commit. Never weaken a test to get green.
- **`status`**: `COMMITTED` is the designer's decision (never change it without approval),
  `PROVISIONAL` is a proposed default, `PLAYTEST` marks balance values tuned from telemetry. New
  content is normally `PLAYTEST`.
- **Retirement.** Shipped ids are retired, never deleted and never reused (13.5). Keep the module and
  its test and set `retired: true` (abilities and items; traits have no retired flag). Then
  `validateLoadout` rejects it (rule 7, code `retired`) and the Dossier, fuzzer and simulator skip it.
  Retirement is a loadout rule only (DD-49): a battle that started with the module keeps resolving it,
  triggers and hooks alike, so it plays and replays the same way. Because the file stays,
  `content:new` refuses the id forever.

## 12. When the engine must change

A new ability is a content change; a new **primitive**, **hook**, **selector**, **condition**,
**event kind** or **fizzle reason** is an engine change (5.2, 13.5). Before deciding you need one,
check whether a combination of existing primitives, selectors, `fx.when`, `fx.atChainEnd` and hooks
already expresses the rule.

If it does not:

1. **Log the decision.** Ambiguity or a missing building block is resolved by the best-case option
   that fits the pillars (spec 1) and logged, never left open:

   ```sh
   pnpm tsx scripts/add-decision.ts "<decision>" "<why it is the best case>" --slug short-name --refs "5.2, R-ABIL-002"
   ```

   This appends the next DD row to spec section 18 and writes `docs/decisions/DD-XX-short-name.md`.
   Never change a COMMITTED rule this way.

2. **Change the SDK and resolver, test first**, in `packages/rules` (rules code is test-first):
   - Primitive: add a variant to `EffectSpec` and a builder to `fx`
     (`packages/rules/src/sdk/types.ts`, `sdk/index.ts`), then a case in `ActionRun.resolveEffect`
     (`engine/action.ts`); the exhaustive `switch` will not compile without it. Decide what counts as
     resolved (DD-17), which fizzle reasons it emits, whether it prompts (use the existing choice
     point so suspension and replay work, DD-11) and which intercepts it passes (DD-35). Filter
     options by public rules only (DD-19).
   - Hook: add it to `RuleHooks`, call it at the right point in the engine through the fixed hook
     order, and give it a `ReadCtx` if it can run during move generation or projection.
   - Event kind or fizzle reason: extend `BattleEvent` or `FizzleReason` in `types.ts`, the projection
     whitelist in `engine/project.ts`, and the client log text in `apps/client/src/battle/describe.ts`.
3. **Tell the neighbours.** Add the flag to the AI's `profileOf` scan if the primitive affects
   material or tempo (§13), update `docs/ARCHITECTURE.md` (2.4, 2.7) and this guide.
4. **Then write the module** and continue with the checklist in §1.

Engine changes land in packages other teams own; coordinate with the rules owner rather than editing
`packages/rules/src` from a content change.

## 13. NPC and AI implications

NPCs (`packages/ai`, R-FMT-005) never read hidden data: they search a belief state built from their
own projection plus their own loadout (9.4), the same construction move previews use. The opponent's
unrevealed abilities and items are simply absent, and private slices are re-initialised.

- **Root moves are exact.** Each candidate move at the root is applied with the full engine
  (`applyWithDefaults`), so every known ability, item, trait and hook resolves exactly, prompts taking
  their default options.
- **Deeper plies use ability profiles.** `profileOf(def)` in `packages/ai/src/knowledge.ts` scans the
  effect data (base and attuned merged, including inside `fx.when` and `fx.atChainEnd`) and sets flags
  per category. The fast search (`fast.ts`) scores captures with them:

| Profile flag     | Set by                                                      | Effect in the fast search                                                 |
| ---------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------- |
| `killsCaptor`    | `effectCapture(target.captor())` in a CAPTURED ability      | The captor is removed unless silenced, negated or protected; kings immune |
| `killsOther`     | Any other `effectCapture`                                   | Penalty for capturing into it; bonus on your own CAPTURES                 |
| `selfRevive`     | `revive(target.self(), ...)`                                | The victim is worth less to capture                                       |
| `reviveFriendly` | Any other `revive`                                          | Bonus on your own CAPTURES                                                |
| `bonus`          | `bonusAction`                                               | Small tempo bonus on your own CAPTURES                                    |
| `negatesVictim`  | `negate('victim', [..'CAPTURED'..])` in a CAPTURING ability | Cancels the victim's reactions                                            |
| `protectsSelf`   | `protect(target.self(), ...)` in a CAPTURING ability        | Cancels `killsCaptor`                                                     |
| `reveals`        | Any `reveal`                                                | Recorded; not scored today                                                |

- **What the profiles do not see:** `fx.move` (no flag), trigger conditions, the difference between
  base and attuned versions, remaining charges, and any hook (items, traits, passives). Movement hooks
  still apply because the search position is built with the hook-derived movement rules, but they are
  fixed at the root and do not follow slice changes inside the search.
- **Choices.** `chooseOption` scores each option by kind: `piece` by the target's value (positive
  for an enemy piece, negative for a friendly one, which assumes the choice harms the target),
  `square` by placing the ability's **bearer** on that square and searching briefly, `move` by
  playing the bonus move (plus a small tempo bonus), and `decline` by searching the position as it
  stands. An ability whose choice helps a friendly piece (for example a chosen `protect`) or places
  a piece other than its bearer (Backwash) is scored with the wrong assumption.
- **Unknown sets** cost a risk penalty when capturing a piece type whose set is not fully known
  (`TIERS[tier].risk`), which is why reveal tools also make NPCs play better.

Content that uses existing primitives therefore needs no AI change to be understood roughly. If your
module's value comes from something the profiles miss, or from a new primitive, ask the AI owner to
extend `profileOf` and `fast.ts`, and check the effect with `pnpm sim`.

## 14. World content: zones, NPCs, lessons and quests

The overworld (spec 10, M5) is data in `packages/content/world/`, exported as
`@chain-theorem/content/world`. The server decides everything (movement, encounters, lesson answers,
quest progress, rewards; R-SEC-003); content only describes. `pnpm content:validate` runs
`validateWorld`, which rejects anything the server could not honour.

| File             | Holds                                                                                                                                              |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `zones.ts`       | `ZoneDef`: id, name, kind (town, route, wild, interior), its Tiled map, the per-step encounter rate and grace steps, encounter entries, the format |
| `maps/*.json`    | Tiled JSON maps (16x16 tiles, orthogonal, one embedded tileset), generated by `tools/gen-maps.ts` (edit the layouts there)                         |
| `tiles.ts`       | The tile list: drawing `kind`, `solid` (blocks movement) and `wild` (tall grass, encounters roll here)                                             |
| `npcs.ts`        | `NpcDef`: name, look, dialog lines, and a role: `talk`, `trainer`, `teacher` (lessons) or `quest` (a quest giver)                                  |
| `lessons.ts`     | Chess Academy lessons (10.3): puzzle lessons (skippable chess basics) and battle lessons (one ability or element each, never skippable)            |
| `quests.ts`      | `QuestDef` steps (`talk`, `reach`, `defeat`, `lesson`, `win` with a constraint) and rewards; key items (`encounterRate` multipliers)               |
| `progression.ts` | PLAYTEST numbers: the XP curve, battle XP by format and result, wild drops, discovery XP, the encounter pacing model                               |

**Maps.** Object layer `objects` holds exactly one `spawn`, `warp` objects (target zone and tile;
every warp needs a return warp next to its landing tile), `npc` objects (each NPC placed once),
named `area` rectangles (quest `reach` steps), `challenge` rectangles (challenge zones, R-WORLD-006:
no grass or warps inside) and `sign` objects. Keep every place reachable from the spawn without
stepping on grass (10.2: paths avoid wild patches); the validator checks it.

**NPCs.** A trainer names its tier, format, level, a reward (a bonus on a win) and `once` (story
trainers pay once; practice trainers every win); its loadout is either a fixed `Loadout` (validated
at the trainer's level, R-LOAD-004) or `{ buildSeed }` for `npcBuild`. A quest `defeat` step must
name a story trainer. Names follow R-ART-003 (original, no franchise names or look-alikes; a test
checks a deny list).

**Lessons.** A puzzle lists every move that reaches its goal (capture for movement, give check,
mate), and the validator checks each against the engine (DD-73). A battle lesson gives both sides
fixed loadouts legal at their levels and teaches exactly one ability or element.

**Quests.** Steps run in order; one event completes at most one step; a `lesson` or `defeat` step
already met completes at once; accepting a quest from its giver completes a leading `talk` step to
that giver (DD-72). Rewards are XP, items, cards, coins and key items; every reward item must be
usable by then (the validator checks minimum levels).

**Checking your change:** `pnpm content:validate`, `pnpm exec vitest run --project unit
packages/content/world` (includes the generated-map check), then walk it in `pnpm dev` or run
`pnpm test:firstwin` if you touched the Academy.

## Appendix A: SDK cheat sheet

Everything a module imports comes from `@chain-theorem/rules/sdk` (types from
`@chain-theorem/rules` too):

```text
defineAbility(def) · defineItem(def) · defineTrait(def)

target.self() · target.captor() · target.victim()
target.chosen({ side, types?, near?: { of, pattern }, exclude? })
target.mostRecentCaptured('friendly' | 'enemy', pieceType)

square.origin() · square.start()
square.chosen({ near?: { of, pattern }, backRank?: true, include?: ('origin' | 'start')[] })

fx.effectCapture(target)
fx.negate('victim' | 'captor', categories)
fx.protect(target, count = 1 | 'all')
fx.move(pieceTarget, square)
fx.revive(pieceTarget, square)
fx.bonusAction({ movers, capture, optional })
fx.reveal({ what: 'typeSet', of } | { what: 'highestCostItem' } | { what: 'items' })
fx.modifyRule(ruleId, params?)
fx.when(condition, effects)
fx.atChainEnd(effects)
fx.revealIfSurvives(target.self() | target.captor() | target.victim())

cond.survives(of) · cond.noLegalCapturerOfCaptor() · cond.typeIs(of, types)
cond.not(c) · cond.all(...cs)

NON_KING // ['pawn', 'knight', 'bishop', 'rook', 'queen']
```

Anchors: `'self'`, `'captor'`, `'victim'`, `'origin'`, `'landing'`. Patterns: `'adjacent'`,
`'diagonal'`, `'orthogonal'`. Trigger conditions: `victimTypeNot`, `victimTypeIs`, `captorTypeIs`,
`captorTypeNot`.

## Appendix B: the catalogue as a pattern library

Find the closest existing module and copy its shape.

| Module                                                      | Kind    | Lvl | Slots | Technique                                                                                        |
| ----------------------------------------------------------- | ------- | --- | ----- | ------------------------------------------------------------------------------------------------ |
| `abilities/scout.ts`                                        | Ability | 1   | 1     | CAPTURING reveal of the victim's set; attuned `highestCostItem`                                  |
| `abilities/hit_and_run.ts`                                  | Ability | 1   | 1     | `move(self, origin)`; attuned chosen square near the origin (DD-20)                              |
| `abilities/last_word.ts`                                    | Ability | 1   | 1     | CAPTURED reveal of the captor's set; attuned `items`                                             |
| `abilities/poisoned_meat.ts`                                | Ability | 2   | 1     | `effectCapture(captor)`; attuned `revealIfSurvives`                                              |
| `abilities/pierce.ts`                                       | Ability | 3   | 1     | `negate('victim', ['CAPTURED'])` in phase 2                                                      |
| `abilities/backdraft.ts`                                    | Ability | 4   | 1     | Chosen target near the last known square, excluding the captor                                   |
| `abilities/antidote.ts`                                     | Ability | 5   | 1     | `protect(self, 1)`; attuned `'all'`                                                              |
| `abilities/cleave.ts`                                       | Ability | 6   | 1     | Chosen enemy pawn by diagonal, attuned adjacent pattern                                          |
| `abilities/momentum.ts`                                     | Ability | 8   | 1     | Optional non-capturing bonus move, 2 charges, `replay`                                           |
| `abilities/reinforce.ts`                                    | Ability | 10  | 1     | Condition, `mostRecentCaptured` revive, attuned `conditions: []`, `revive`                       |
| `abilities/riposte.ts`                                      | Ability | 12  | 1     | Bonus capture of the captor (nested pipeline); `when` fallback; `replay`                         |
| `abilities/rebirth.ts`                                      | Ability | 14  | 1     | `atChainEnd` self-revive, 1 charge; attuned back-rank choice; `revive`                           |
| `abilities/stalwart.ts`                                     | Passive | 16  | 1     | `moveFilter.kingMode`; engine-handled reveal                                                     |
| `abilities/veil.ts`                                         | Passive | 18  | 1     | `revealFilter.reveal`                                                                            |
| `items/dual_adepts_glove.ts` (and the other capacity items) | Item    | 1   | 1     | Data-only capacity item                                                                          |
| `items/multitaskers_schedule.ts`                            | Item    | 10  | 1     | `grants.perTypeSets`                                                                             |
| `items/blended_family.ts`                                   | Item    | 15  | 1     | `grants.secondElement`                                                                           |
| `items/attunement_charm.ts`                                 | Item    | 4   | 1     | `param.element` + `attunement` hook                                                              |
| `items/scouts_lens.ts`                                      | Item    | 3   | 1     | `onBattleStart` reveal with an item source                                                       |
| `items/resonance_crystal.ts`                                | Item    | 6   | 1     | `silenceOverride` + private per-side slice + `revealSelf`                                        |
| `items/masquerade_mask.ts`                                  | Item    | 14  | 1     | `revealFilter.element` + `onEvent` + slice `init` computed per side                              |
| `items/wardens_stopwatch.ts`                                | Item    | 18  | 1     | Two-sided `triggerFilter` on tags                                                                |
| `traits/hot_foot.ts`                                        | Trait   | —   | —     | Public hashed slice, `blockedSquares`, `effectIntercept`, `onPieceMoved`, `onEvent`, `onTurnEnd` |
| `traits/flow.ts`                                            | Trait   | —   | —     | `moveFilter.passThrough`                                                                         |
| `traits/overabundance.ts`                                   | Trait   | —   | —     | `modifyCharges`                                                                                  |
| `traits/always_first.ts`                                    | Trait   | —   | —     | `queueOrder` stable partition                                                                    |
| `traits/bulwark.ts`                                         | Trait   | —   | —     | `effectIntercept` + public slice                                                                 |
| `traits/stillness.ts`                                       | Trait   | —   | —     | `triggerFilter` negation                                                                         |
