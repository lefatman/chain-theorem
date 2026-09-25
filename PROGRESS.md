# PROGRESS

Branch: `claude/admiring-keller-uk28l5` (single session branch, DD-16). Spec: `docs/DESIGN.md`.
Build plan: `docs/BUILD_PROMPT.md`. Interfaces: `docs/ARCHITECTURE.md`.

## Handoff note

(Top of file. Updated whenever a session ends mid-step.)

- Current step: M6 (economy, social and billing).
- Done so far: M0, M1, M2 (23 review findings fixed, DD-41..DD-55, 100k fuzz re-run green), M3
  (board scene, overlay, AI, simulator, Scenario Lab, e2e, budgets all passing), Playtest Gate 1
  report (designer questions open; the build continues per BUILD_PROMPT 6), M4 (online battles).
- M5 complete: world content (4 zones, 18 NPCs, 7 lessons, 3 quests), the pure zone core, the
  ZoneRoom host with world battles and idempotent rewards, parties, the Metrics cost dashboard, the
  overworld client; `pnpm test:load` and `pnpm test:firstwin` are the done-when, both in CI.
- M6 6.1–6.3 done: trading and wagers with escrow, ranked queues with Glicko-2, leaderboards, guilds
  with guild chat, billing (fake provider end to end, Paddle behind keys), trial and entitlement.
- Next: M6 6.4 report, mute, block and the admin console; then the M6 done-when evidence.
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
- [ ] 6.4 Report, mute, block; minimal admin console.
- Done when: concurrency tests show no item duplication; billing works end to end in test mode.

## M7 — Tournaments, spectating, content

- [ ] 7.1 TournamentRoom: Swiss and single elimination.
- [ ] 7.2 Delayed public-projection spectating.
- [ ] 7.3 Storm, Stone, Frost + 18 creatures; another zone with NPC trainers; more abilities and items.
- Done when: the first public tournament completes (locally, with test accounts).

## Release checklist (spec 17.3)

- [ ] All INVARIANT requirements have passing tests.
- [ ] R-SEC-001 payload scan passes across 10,000 fuzzed battles.
- [ ] Balance targets met in simulator (closed beta is human-only).
- [ ] Measured infrastructure cost ≤ $0.10 per subscriber per month.
- [ ] The designer has reviewed the delegated decisions log (section 18) — human-only.

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
