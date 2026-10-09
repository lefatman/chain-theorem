# PROGRESS

Branch: `claude/admiring-keller-uk28l5` (single session branch, DD-16). Spec: `docs/DESIGN.md`.
Build plan: `docs/BUILD_PROMPT.md`. Interfaces: `docs/ARCHITECTURE.md`.

## Handoff note

(Top of file. Updated whenever a session ends mid-step.)

- Status: the build is complete. M0–M7 are done and the final report has been posted. What remains
  of the release checklist (17.3) is human-only: balance sign-off and the review of section 18.
- Done: M0–M7. M7: Swiss and single-elimination tournaments (TournamentRoom, `pnpm tournament:local`),
  delayed public-projection spectating (2 plies behind; spectators learn only what both players
  know), Storm, Stone and Frost with 12 abilities, 2 items and Highcairn Pass.
- Post-release art pass (designer direction, DD-96): the battle pieces are human soldiers in four
  army styles (Roman, medieval, Arab, samurai) at 32 px; the owner shows in the armour colour, the
  element in the accents and an emblem. Army style is a setting; the opponent's style always differs.
  Overworld trainers redrawn at 17x26 in the same handheld-era proportions with a 3-frame walk.
- Catalogue plan (designer brief 2026-10-06, spec 5.7/5.8, DD-97..DD-104): Phase 0 (spec, decisions)
  Phase 1 (neutral-first catalogue: one signature per element, 18 cards neutral), Phase 2
  (Necromancer, Quantum Kill; piece rank, `rank` filters, `target.chosenCaptured`, `square.startElse`,
  `cond.noneMatch`, golden E10/E11) and Phase 3 (Obstinate, Block Path, Stalwart rework;
  `moveFilter.captureFilter`/`bypass`, `onActionEnd` with `ctx.choose`, loadout rule 8, the `venom`
  tag, DD-105 prompt visibility, golden E12-E14) and Phase 4 (Electric Slide: pawn leapfrog and
  slider redirects in move generation and attack detection, `moveFilter.pawnLeap`/`redirects`,
  `ctx.attuned`; Squall neutral; golden E15), Phase 5 (Redo: the REWIND primitive with pre-action
  snapshots, golden E16) and Phase 6 (Schrödinger's Joker: SPAWN, linked fate, twin moves after the
  normal move, behind `PLAYTEST_FLAGS.schrodingers_joker`; golden E17) are done. The eight abilities
  of the brief are all in. Open for the designer: the 100,000-game fuzz (`pnpm test:fuzz:full`) for
  the Joker gate (17.3), and the balance questions in `docs/BALANCE_DD98.md`. Balance after
  Phase 1: see `docs/BALANCE_DD98.md` (First Blood advantaged element 46%, Full Battle 90%: the
  silence rule now dominates long games and traits dominate short ones; the designer's levers are
  `silenceScope` and trait numbers).
- Open for the designer: balance targets partly missed (`docs/BALANCE_M7.md` section 5, five
  questions), Playtest Gate 1 questions, review of spec section 18 (DD-01..DD-95; DD-10 onwards each
  have a record in `docs/decisions/`).
- Next for the human: `corepack enable && pnpm install && pnpm check`, then `pnpm seed` and
  `pnpm dev` and the manual steps in `TESTING.md`; for production, the human-only items below and
  `DEPLOY.md`.
- The `TODO` strings in `apps/tools/src/content/new.ts` are scaffold template text for new modules,
  not open work.

## Arcane Chess codebase path (step 2.8)

Not provided. If the designer adds a path here, mine it for ability edge cases and add golden tests.
Until then step 2.8's "Arcane Chess" part is skipped (noted, not faked).

## M0 — Repository and guardrails

- [x] 0.1 pnpm monorepo as in 13.1; TypeScript strict, ESLint, Prettier, Vitest.
- [x] 0.2 GitHub Actions: typecheck, lint, tests on every PR, plus a PostgreSQL service container job.
- [x] 0.3 `docs/DESIGN.md`; `AGENTS.md`/`CLAUDE.md` with commands and standing instructions.
- [x] 0.4 (human-only) Neon project + Hyperdrive config. Agent part done: `DEPLOY.md` steps and `pnpm deploy:check`; the Neon/Hyperdrive creation itself is listed under Human-only items.
- Done when: `pnpm check` passes in CI on the empty skeleton.

## M1 — Pure chess core

- [x] 1.1 Board representation and move generation: all pieces, castling, en passant, promotion (R-RULES-001).
- [x] 1.2 Check, checkmate, stalemate, 50-move rule, threefold repetition via Zobrist (R-RULES-005).
- [x] 1.3 Perft: start position, Kiwipete and more published positions.
- [x] 1.4 Typed event emission for every move.
- Done when: perft start depth 5 = 4,865,609; Kiwipete depth 4 = 4,085,603.

## M2 — Ability, element and loadout engine

- [x] 2.1 Content module system: SDK (`defineAbility`, `defineItem`, `defineTrait`), hooks, CAPS config, registry generator, scaffolding and validator CLIs.
- [x] 2.2 Effect primitives and the five-phase pipeline with the resolution queue in state (5.2–5.4).
- [x] 2.3 Loadout model and validation: level requirements, slot costs, Schedule, Blended Family (7.3, 7.4, 6.4).
- [x] 2.4 Silence rule, six element traits as modules, `silenceScope` config (6.1, 6.2).
- [x] 2.5 Stalwart, Royal Immunity, INV-03 fizzle check, format objectives (4.3–4.5, 9.1).
- [x] 2.6 `project()`, reveal logs, Dossier deductions (8.2–8.5).
- [x] 2.7 14 starter abilities and 11 items as content modules only (5.7, 7.2).
- [x] 2.8 Golden tests E1–E9 (Arcane Chess part skipped: no path provided; see top of file).
- [x] 2.9 Property tests: determinism, chain termination, projection safety.
- Done when: 100,000 fuzzed games with random loadouts finish with no crash, no unbounded chain and identical replays.

## M3 — Local battle prototype

- [x] 3.1 Vite + Phaser 4 board scene, procedural placeholder art meeting 11.2, Classic View.
- [x] 3.2 Preact overlay: loadout builder, Dossier, step-through event log, move preview (8.4).
- [x] 3.3 `@chain-theorem/ai`: iterative-deepening alpha-beta, time budget, ability-aware eval; Wild/Trainer/Elite.
- [x] 3.4 Balance simulator CLI (`pnpm sim`): win rates per element matchup and build archetype.
- [x] 3.x Scenario Lab (dev-only): E1–E9 or custom position + loadouts, step through the chain.
- [x] 3.x Budgets measured (bundle size, memory, frame rate; 12.3): 9 of 9 pass, see `docs/BUDGETS.md`.
- Done when: First Blood, Vanguard and Full Battle playable vs any NPC tier with any loadout; simulator prints a matchup table.

## Playtest Gate 1

- [x] `docs/PLAYTEST_GATE_1.md`: simulator tables vs 17.2 targets, tuned PLAYTEST values and why, 15-minute designer checklist.

## M4 — Online battles

- [x] 4.1 Worker entry, passwordless email (console locally) and OAuth (when keys exist), sessions (R-SEC-006).
- [x] 4.2 `@chain-theorem/protocol` and BattleRoom: hibernating sockets, projection, alarm clocks, reconnect replay, prompts.
- [x] 4.3 Matchmaker DO: casual queues and challenge links.
- [x] 4.4 Database package: Kysely schema, migrations, repositories; SQLite/D1 local, PostgreSQL prod; logs to R2.
- [x] 4.5 18 creature sprite sets (procedural pixel sprites + drop-in pipeline; `assets/LICENSES.md`).
- Done when: two browsers complete timed battles with a mid-battle disconnect and reconnect; R-SEC-001 payload scan passes.

## M5 — Overworld vertical slice

- [x] 5.1 Tiled maps: Chess Academy town, one route, wild patches; ZoneRoom with channels (10.1).
- [x] 5.2 Server-side encounters into NPC battles; idempotent rewards (10.2, R-SEC-003).
- [x] 5.3 NPC trainers, data-driven quests, Chess Academy tutorial (10.3, 10.5).
- [x] 5.4 Chat with youngest-participant filtering (R-SEC-011), friends, parties, consent PvP challenges, challenge zones.
- [x] 5.5 Telemetry (Analytics Engine / local sink) and cost dashboard (14.2).
- Done when: 50 simulated clients in one zone stay inside cost guardrails; new player reaches a first win in < 30 minutes.

## M6 — Economy, social and billing

- [x] 6.1 Trading (TradeSession + transactions), item wagers with escrow, guilds, leaderboards.
- [x] 6.2 Ranked queues with slot brackets and Glicko-2.
- [x] 6.3 Billing: fake provider + Paddle sandbox, 7-day trial, verified webhooks, entitlement checks (Paddle sandbox run itself is human-only: keys).
- [x] 6.4 Report, mute, block; minimal admin console.
- Done when: concurrency tests show no item duplication; billing works end to end in test mode.

## M7 — Tournaments, spectating, content

- [x] 7.1 TournamentRoom: Swiss and single elimination.
- [x] 7.2 Delayed public-projection spectating.
- [x] 7.3 Storm, Stone, Frost + 18 creatures; another zone with NPC trainers; more abilities and items (balance targets partly missed: designer questions in `docs/BALANCE_M7.md`).
- Done when: the first public tournament completes (locally, with test accounts).

## Balance and alpha plan (designer request 2026-10-09)

One item per session run, with singular focus; sub-items may go to agents. Each item ends with
`pnpm check`, its own simulator or fuzz evidence, a commit and a push; design changes get a DD row.
The proposal behind the list is in the chat record of 2026-10-09 and summarised per item here.

- [x] B1 Simulator build picker deals all four categories and includes passives (Stalwart on the
      king set only); new `--suite cards` mirror test per ability; baseline tables for both formats
      and both silence scopes in `docs/BALANCE_BASELINE.md`. Tooling only, no design decision.
- [ ] A2 Alpha one-time-code match mode for non-logged-in players: guest tokens behind a Worker var
      (off in production), creator picks level 1-30, format and a loadout from everything at or
      below that level, `c-<code>` lobby that expires in 30 minutes, single-use code, random colours,
      no XP, rewards, rating, drops, telemetry, chat or spectating; client `#/alpha` screen; server
      unit tests and one two-browser e2e; DD row.
- [ ] B3 Silence scope `ONCE_PER_ABILITY` as a PLAYTEST knob (the foil silences each ability on each
      piece type once per battle); Resonance Crystal "not even once" under it; sim run; DD row.
- [ ] B4 Trait numbers as config knobs (Flow: at most one allied piece passed per move; Bulwark:
      non-pawns only; Overabundance: +1 charge, not x2; Hot Foot: 4 turns); re-measure Storm vs Stone
      first; one sim run per change; DD row. Identities (6.1) stay COMMITTED.
- [ ] B5 Per-card changes and loadout rule 9: Redo non-pawn; Obstinate ignored by kings, 2 slots;
      Block Path 2 slots and a king's facing resets to forward after it moves; rule 9 at most two
      Passive abilities per set; Pierce 2 charges; Scout's Lens reveals the whole pawn set; sim run;
      DD rows.
- [ ] C6 Three neutral abilities: Cornered (Captured, L4, 1 charge, rim squares), Ricochet (Captures,
      sliders, L8, 2 charges, continue past the capture), Overwhelm (Capturing, L9, 2 charges, negate
      a lower-ranked victim's Captured abilities); primitives logged; golden examples; fuzz; sim.
- [ ] C7 Three items: Duelist's Gauntlet (L10), Reliquary (L12, revive), Herald's Horn (L7); fuzz; sim.
- [ ] B8 Final balance report against 17.2 on the finished catalogue, 3,000-game fuzz, PROGRESS
      handoff.

## Release checklist (spec 17.3)

- [x] All INVARIANT requirements have passing tests (`pnpm req:coverage`: all 83 requirement IDs,
      11 of them INVARIANT, have named tests; every suite green).
- [x] R-SEC-001 payload scan passes across 10,000 fuzzed battles (`pnpm test:fuzz:full` scans 10,000
      of 100,000 games for players and spectators; a separate 20,000-game run scanned all of them).
- [ ] Balance targets met in simulator (closed beta is human-only). Partly: White win rate and Full
      Battle surprise losses meet 17.2; the advantaged-element rate (64% First Blood, 73% Full
      against 55–60%), First Blood surprise losses and the Focused build do not. The fixes are
      kit-level design calls: five questions in `docs/BALANCE_M7.md` section 5 (and Playtest Gate 1).
- [x] Measured infrastructure cost ≤ $0.10 per subscriber per month (`pnpm test:load`: $0.0305
      from bot traffic, $0.0149 from server telemetry, per heavy subscriber-month; re-measure in
      production from the cost dashboard, R-COST-003).
- [ ] The designer has reviewed the delegated decisions log (section 18, DD-01..DD-95) — human-only.

## Human-only items

- Cloudflare account, `wrangler login`, Workers Paid plan.
- Neon project and connection string, then a Hyperdrive configuration (step 0.4).
- Paddle account (sandbox, then live), product and price IDs, webhook secret, product-category approval.
- Transactional email provider for magic links.
- OAuth client IDs (optional).
- Final creature art and music (procedural art ships until then).
- Designer sign-off at Playtest Gate 1 and review of spec section 18.
- Arcane Chess codebase path for step 2.8 (optional).

## Evidence log

(Newest first: date, step, commands run, pass counts.)

- 2026-10-06 Catalogue Phase 6 (DD-101): Schrödinger's Joker (level 20, Captures, neutral, non-king,
  1 charge) on the new SPAWN primitive: a twin (new piece id from 32, same type/element/abilities)
  waits on the captor's square; after the owner's normal move and chain every twin makes its own
  declinable move (a waiting twin steps onto an empty spawn square first, or its original moves out
  and it takes the square), each with its own chain; linked fate removes the whole group on any
  member's capture (`linked_fate` rule source, waiting twins flagged); `TWIN_GROUP_MAX` 3 in CAPS;
  `Spawned`/`Emerged` events, `MoveMade.twin`; Zobrist keys for ids past 31 appended so old hashes
  stay; waiting twins and groups hashed; rewinds restore them. Client draws waiting twins, lab and
  replay rebuild them; AI values a spawning capture. Behind `PLAYTEST_FLAGS.schrodingers_joker`
  (on); the spectator delay now counts committed moves (DD-92 amended). `pnpm check` 1,575 unit tests (schrodingers_joker 11, examples E17); `pnpm test:fuzz` 500 games 0 failures;
  `tsx apps/tools/src/fuzz/cli.ts --games 3000 --seed 7`: 3,000 games, 268,707 plies, replays
  identical, 3,000 projection-scanned, no crash, max 22 events per action. The 100,000-game run
  (`pnpm test:fuzz:full`, hours on this hardware) stays on the release checklist (17.3).

- 2026-10-06 Catalogue Phase 5 (DD-100): Redo (level 15, Captured, neutral, replay, 1 charge) on
  the new REWIND primitive: the engine keeps the pre-action snapshots of the last two actions while
  a rewind ability is in play (`GameState.history`, never projected), a resolved rewind ends the
  action (`RewindSignal`) and restores board, pieces, turn, ply, slices, objective, check state and
  the repetition history while charges, reveals and the event sequence survive; `Rewound` event;
  only capturing moves trigger it (5.4: effect captures do not chain); the `replay` tag now also
  covers rewinds (Warden's Stopwatch negates Redo). AI treats a known-Redo capture as a loss of
  tempo. `pnpm check` 1,560 unit tests (redo 11, examples E16, Scenario Lab and replay viewer rebuild rewound frames), `content:validate` ok (32 abilities),
  `req:coverage` 83/83; `pnpm test:fuzz` 500 games, replays identical, 0 failures.

- 2026-10-06 Catalogue Phase 4 (DD-104): Electric Slide (level 3, Storm signature, Passive) with a
  base/attuned split: pawns leap one adjacent ally (plain move, no en passant, promotes); attuned
  sliders turn at allied squares once per move (queen twice), never stopping on the ally nor
  continuing straight or back; `Pos.attacked` walks the same paths backwards (checks, pins and
  Block Path's approach direction through turns); `moveFilter.pawnLeap`/`redirects` hooks,
  `ReadCtx.attuned` for passives, movement grants in the reveal-on-observation framework (the
  Attunement Charm is revealed with the first observed turn it alone allows). Squall is neutral
  (version 2, attuned version retired); NPC and simulator builds pick an element's signature
  passive. `pnpm check` 1,544 unit tests (electric_slide 12, squall tests updated, examples E15), `content:validate`
  ok (31 abilities), `req:coverage` 83/83; `pnpm test:perft` 30/30; `pnpm test:fuzz` 500 games,
  replays identical, 0 failures.

- 2026-10-06 Catalogue Phase 3 (DD-99, DD-102, DD-105): Obstinate (level 9) and Block Path (level 12) as neutral passives; Stalwart (version 2) on any piece: effect captures fizzle (`stalwart_guard`)
  unless the effect carries the new `venom` tag (Poisoned Meat, version 2), bypass of blocked squares
  and soft capture restrictions, loadout rule 8 (`excluded_category`, `AbilityDef.excludes`).
  Engine: `MoveRules` capture restrictions (per victim: attacker ids, hard/soft compass masks,
  bypass flags) applied in `Pos.pseudo`/`attacked` (a king is not in check from its Block Path
  facing; castling paths included), `moveFilter.captureFilter`/`bypass` hooks, `onActionEnd` hook
  with `ctx.choose` (the facing prompt: kind square, purpose `facing`, declinable), `FacingSet`
  event, reveal-on-observation of restrictions (legal-move and check comparisons at Settle, bonus
  options, the mover's own relaxed move), DD-46 public-knowledge INV-03 for hidden facings, pending
  prompts hidden from the opponent until the ability is known (DD-105). Compass helpers
  (`COMPASS`, `stepTowards`, `compassFrom`, `dirFrom`). AI faces the strongest attacker; client
  draws facing wedges, labels facing options, names the stalwart fizzle. `pnpm check` 1,528 unit
  tests (obstinate 9, block_path 13, stalwart 21, examples 28, loadout rule 8 and its property mutation), `content:validate`
  ok (30 abilities), `req:coverage` 83/83, `format:check` clean; `pnpm test:perft` 30/30;
  `pnpm test:fuzz` 500 games, replays identical, 0 failures. Reduced `pnpm sim --suite elements`
  (20 games per pairing First Blood, 12 Full Battle, 20,000 nodes): advantaged element 42.9% /
  88.2%, white 54.3% / 51.6%, surprise losses 33.1% / 0.0%, unchanged in kind from
  `docs/BALANCE_DD98.md`; the simulator's build picker skips passives, so Obstinate and Block Path
  are not in these builds (only the Stalwart king set changed under rule 8).

- 2026-10-06 Catalogue Phase 2 (DD-97, DD-103): Necromancer (level 11, 1 charge) and Quantum Kill
  (level 13, 2 charges) as neutral Captures modules; engine: `PIECE_RANK`/`rankCompare`, trigger
  condition `rank`, `PieceFilter.rank`, `target.chosenCaptured` (options in square order of starting
  squares), `square.startElse`, `cond.noneMatch`; AI scores revive/move prompts; client labels
  captured-piece options; golden examples E10 and E11 in the Scenario Lab. `pnpm check` 1,490 unit
  tests (necromancer 8, quantum_kill 7, examples 25), `content:validate` ok (28 abilities),
  `req:coverage` 83/83; `pnpm test:fuzz` 500 games, replays identical, 0 failures.

- 2026-10-06 Catalogue Phase 0-1 (DD-97..DD-104): spec 5.7 rewritten, 5.8 planned abilities, 6.3/6.5/4.3/7.2
  updated; 18 ability modules neutral (versions bumped), signatures Cleave and Stonewall at level 3;
  validator rule "exactly one signature per element"; wild drops include neutral cards. `pnpm check`
  1,467 unit tests, `content:validate` ok, `req:coverage` 83/83, `format:check` clean; `pnpm test:fuzz`
  500 games 0 failures; `pnpm sim` elements: First Blood advantaged element 46.4% (was 64.0%), Full
  Battle 89.8% (was 73.1%), white 51.4% / 47.9%, surprise losses 35.2% / 0.0%; archetypes: Maximum
  beats Flexible 69% (FB) and all three in Full Battle (65-75%).

- 2026-10-06 Art: overworld trainers at 17x26 with a 3-frame walk (stand, left, right; alternating
  by step parity). `pnpm check` 1,469 unit tests; `pnpm format:check` clean; `pnpm test:e2e` 19/19;
  `docs/screenshots` refreshed from the running game (local battles with medieval, samurai and
  Roman armies, the Academy with the new trainers). `pnpm test:e2e:online` 9/9 (battle, first win,
  two players in the world, trade and wager, checkout, guild, moderation, spectating, tournament);
  `pnpm measure:client` 9 of 9 budgets pass with the new art (initial JS 102.8 kB gzip, first
  playable 587.0 kB, minimum device 38.2 fps, desktop 58.3 fps, renderer PSS under 150 MB on both
  profiles; `docs/BUDGETS.md` updated).

- 2026-10-06 Art: human armies (DD-96). `pnpm check` 1,469 unit tests (art: silhouettes by type
  across styles, front/back faces, owner brightness, emblems per element under colour-vision
  simulations, badge corner clear), `req:coverage` 83/83; `pnpm test:e2e` 19/19; `pnpm format:check`
  clean; board screenshots at 1280x800 and 390x844 with each side in a different style.

- 2026-09-25 Release: CI run 54 on `fb97bb1` green on all 8 jobs (check, perft, quick fuzz, SQLite,
  PostgreSQL, Durable Objects, Playwright local and online, and load, first win and both tournament
  formats). `pnpm check` on the final tree: 1,468 unit tests (2 skipped), `req:coverage` 83/83.

- 2026-09-25 Release: `pnpm test:fuzz:full` on the final catalogue (26 abilities, 13 items, six
  elements): 100,000 games, 8,780,184 plies, 0 failures, replays identical, 10,000 games
  projection-scanned for players and spectators, max 27 events in one action, 599 s on 4 cores.
  `pnpm measure:client`: 9 of 9 budgets pass on two consecutive runs (initial JS 101.4 kB gzip,
  first playable 583.3 kB, minimum-device NPC game 38.2 fps, desktop 58.1 fps, renderer PSS
  127.7 / 148.7 MB) after the online screens and the in-thread NPC fallback became lazy chunks (the
  desktop renderer had reached 151 MB with the M6–M7 screens and the AI in the main bundle).

- 2026-09-25 M7 done-when: `pnpm tournament:local` completes an 8-player Swiss tournament (4 rounds,
  Bot 7 won 4/4, 3 prizes granted once each, 32 s) and `--format se` a knockout (Bot 1 won, 4 prizes,
  23 s) through the real Worker with bot clients; `e2e-online/tournament.spec.ts` runs a tournament
  through the UI in two browsers. Suites on the integrated tree: `pnpm check` 1,468 unit tests and
  `req:coverage` 83/83 IDs; `pnpm test:perft` 30/30; `pnpm test:fuzz` 500 games, players and
  spectators scanned, 0 failures; a 20,000-game fuzz (seeds 501–20,500) 0 failures, all projection-
  scanned; `pnpm test:db` 202 (+94 pg-only); `pnpm test:db:pg` 296/296; `pnpm test:workers` 63/63;
  `pnpm test:e2e` 19/19; `pnpm test:e2e:online` 9/9; `pnpm test:load` $0.0305 / $0.0149;
  `pnpm test:firstwin` 14.7 minutes. Balance (`pnpm sim`, `docs/BALANCE_M7.md`): White 50.0% /
  52.5% and Full Battle surprise losses 0.5% met; advantaged element 64% / 73%, First Blood surprise
  losses and Focused builds missed (designer questions).

- 2026-09-25 M6 done-when: concurrency tests show no item duplication (`pnpm test:db:pg` 271/271:
  parallel two-way trades, escrows and settlements, rewards racing trades on the same rows, guild
  member-cap races; the same suites on SQLite and D1 in `pnpm test:db` 185); billing works end to
  end in test mode with the fake provider (`apps/server/test/billing.test.ts`, and
  `e2e-online/billing.spec.ts` paying on the fake checkout in a browser at 360x640); a real Paddle
  sandbox payment needs the human-only keys (DEPLOY.md 5). 6.4: `pnpm test:workers` 53/53 (moderation
  16, incl. a suspended player's export and deletion), `pnpm test:e2e:online` 7/7 (block, report,
  admin console, suspension, data rights), `pnpm check` 1,243 unit tests, `pnpm test:e2e` 19/19,
  `pnpm test:load` $0.0305 / $0.0149, `pnpm test:firstwin` 14.7 minutes.

- 2026-09-25 M6 6.1–6.3: `pnpm check` 1,225 unit tests; `pnpm test:db` 165 (+76 PostgreSQL-only);
  `pnpm test:db:pg` 241/241 including the concurrency tests (24 parallel two-way trades and 10
  escrows on the same inventory rows, 8 racing settlements, guild member cap races: totals conserved,
  no duplication); `pnpm test:workers` 37/37 (trade 5, billing 7, ranked, guild); `pnpm test:e2e`
  19/19; `pnpm test:e2e:online` 6/6 (M4 battle, M5 first win and two players, a trade and a wager
  battle, the fake checkout at 360x640, a guild with guild chat and the ranked panel);
  `pnpm test:load` $0.0305 / $0.0149 per heavy subscriber-month; `pnpm test:firstwin` 14.7 minutes.

- 2026-09-25 M5 done-when: `pnpm test:load` (50 bots in one zone for 60 s at 1 message per second
  each, against `wrangler dev`): all 50 connected, 3,000 messages in and 146,000 out, step fan-out
  p50 119 ms and p95 249 ms locally, projected $0.0305 per heavy subscriber-month from the bots'
  traffic (conservative, no hibernation credit) and $0.0149 from the server's own telemetry, against
  the $0.10 guardrail (two runs, identical). `pnpm test:firstwin`: a new account accepts the
  Headmaster's quest, solves all 13 chess puzzles and wins the Hit and Run lesson battle through
  the real Worker; human time model 14.7 minutes (limit 30). Both run in CI (`load` job).
- 2026-09-25 M5 tests: `pnpm check` 1,153 unit tests (zone core 74, world host 17, world content 30,
  client 121 of which 43 world); `pnpm test:workers` 17/17 (zone: entering, discovery once, Academy
  quest and lessons, trainer battle paid once, wild encounter, chat filtering with a minor, whispers
  and parties across zones, consent challenge, channel overflow, cost dashboard); `pnpm test:db` 101
  and `pnpm test:db:pg` 145/145; `pnpm test:e2e` 19/19; `pnpm test:e2e:online` 3/3 twice (the M4
  battle, a first win through the UI in the Academy, two players meeting in the world); initial JS
  95.0 kB gzip (world 28.7 kB and its scene 12.2 kB load lazily).

- 2026-09-25 M4 done-when: `pnpm test:e2e:online` 1/1 (three consecutive runs): two browser contexts
  against `wrangler dev` sign up by magic link, play a timed Full Battle from a challenge link, one
  reloads mid-battle and rejoins (reconnect replay, the other sees the grace countdown), the battle
  ends by resignation, and no WebSocket frame either browser received contains the other's
  unrevealed ability id. "Different networks" is covered by separate browser contexts on one machine;
  a two-machine run needs a deployed Worker (human-only).
- 2026-09-25 M4 tests: `pnpm check` 982 unit tests (battle core 30 incl. a 48-battle sweep with 4,956
  messages scanned, auth 9, pairing 4, protocol 13, NPC builds 3, online controller 4);
  `pnpm test:db` 89 (SQLite and D1); `pnpm test:db:pg` 127/127 on a local PostgreSQL 16;
  `pnpm test:workers` 7/7 inside workerd; `pnpm test:e2e` 19/19; CI green.

- 2026-09-25 M3 budgets: `pnpm measure:client` 9 of 9 pass after on-demand board rendering (the Phaser
  loop sleeps while the board is still): initial JS 66.4 kB gzip, first playable 462.7 kB, minimum
  device 38.3 fps (idle 60), desktop 58.6 fps (idle 60), peak JS heap 22–26 MB, renderer PSS
  126–148 MB. Headless Chromium with software WebGL; re-measure on a real phone before release.
- 2026-09-25 M3 e2e: `pnpm test:e2e` 19/19 (local battles in every format and NPC tier, hot-seat,
  loadouts, settings, title). NPC fix: the first search iteration always completes, so a loaded
  device cannot make it hang a piece to a one-move capture (regression test in `objective.test.ts`).
- 2026-09-25 M2 review: 23 findings from two adversarial spec-conformance reviews fixed (DD-41..DD-55),
  each with a regression test (`packages/content/test/regressions.test.ts`); `pnpm check` 913 unit
  tests; perft 30/30; `pnpm test:fuzz:full`: 100,000 games, 8,086,327 plies, 0 failures, replays
  identical, 10,000 games projection-scanned with the stricter scanner (per-type names, Veil fields,
  masked elements, pending burns), max 31 events per action, 463 s on 4 cores.

- 2026-09-25 M2 done-when: `tsx apps/tools/src/fuzz/cli.ts` in four 25,000-game chunks (seeds 1–100,000,
  `--scan-every 10`): 100,000 games, 8,088,493 plies, 0 failures, replays identical (events and final
  hash), no crash, max 31 events in one action, 10,000 games R-SEC-001 projection-scanned with no leak.
- 2026-09-25 M2 tests: `pnpm check` green, 503 unit tests (chess core 96, golden E1–E9 11, 14 ability
  suites, 11 item suites, 6 trait suites, elements, invariants 66). Engine fixes found by tests: Stalwart
  reveal on capture, per-type ability knowledge in projections (Veil), Promoted element under Masquerade,
  capture ids fixed at commit (Resonance Crystal).
- 2026-09-25 M1 1.2/1.4: `packages/rules/test/chess.test.ts` 96/96 (castling, en passant, promotion,
  check, mate, stalemate, 50-move, repetition, events, purity, full-engine perft cross-check).
- 2026-09-25 M1 1.1/1.3: `pnpm test:perft` 30/30 (7 positions; start d5 4,865,609; Kiwipete d4 4,085,603) in 4.4 s.
- 2026-09-25 M0: `pnpm check` green on the skeleton (typecheck, lint, 1 unit test, deps:check); secret scan clean.
