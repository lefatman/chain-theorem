# Chain Theorem — Master Build Prompt

## How to use this (for Jeff, not part of the prompt)

1. Create an empty folder `chain-theorem/` and run `git init` in it. Put `DESIGN.md` at `docs/DESIGN.md` and this file at `docs/BUILD_PROMPT.md`.
2. Open Claude Code in that folder with Opus at maximum effort and paste everything under **PROMPT** below.
3. A project this size takes many sessions. The prompt makes Claude keep `PROGRESS.md` current, so when a session ends, start a new one and send: `Continue the build: follow docs/BUILD_PROMPT.md and PROGRESS.md.`
4. Local play and every automated test run without accounts. Only production deployment, live billing, OAuth, email delivery and final art need you (see section 11 of the prompt).
5. When it reports done, follow `TESTING.md` in the repo.

---

## PROMPT

### 1. Mission

You are the lead engineer and sole implementer of **Chain Theorem**, a browser-first MMO where every battle is chess shaped by capture-triggered abilities. Build the complete project specified in `docs/DESIGN.md` (the spec): every step of milestones M0 to M7 in spec section 16, production-ready, fully tested, documented and deployable, plus a testing guide for a human.

Work top down: understand the whole spec, define the architecture and interfaces, then build milestone by milestone, proving each gate before moving on.

### 2. Authority and decisions

- The spec is binding. Precedence (spec section 0): INVARIANT, then COMMITTED, then ability or item text, then PROVISIONAL. PLAYTEST values live in config and content data, never in engine code.
- The designer has delegated every open decision (D-37). Never stop to ask. When the spec is silent or ambiguous, choose the best-case option that fits the pillars (spec section 1), add it as a new DD row in spec section 18 and as a short record in `docs/decisions/`, then continue.
- Never change a COMMITTED rule to make implementation easier. If two COMMITTED rules truly conflict, follow the higher-precedence one and log the resolution.
- Additions the spec does not mention (dev tools, test harnesses) are allowed when they serve the spec. Log them the same way.

### 3. Session protocol (every session, including the first)

1. Read `CLAUDE.md` and `PROGRESS.md` if they exist, and `git log --oneline -20`.
2. First session: read the whole spec once, end to end. Later sessions: reread only the sections your current step cites.
3. Resume at the first unchecked step in `PROGRESS.md`.
4. After each step: run `pnpm check` plus that step's tests, commit, then update `PROGRESS.md` with status, evidence (commands run and pass counts), the next step and any blockers.
5. Never end a session or make a commit with a failing build. If context runs low, finish or cleanly shelve the current step, commit, and write a handoff note at the top of `PROGRESS.md`.

### 4. Phase 0: plan top down before writing product code

1. Write `docs/ARCHITECTURE.md`: the package map and dependency rules (spec 13.1), and each package's public interface as TypeScript signatures: rules engine (13.2), content SDK and hooks (13.5), repositories (13.6), protocol messages (13.4), Durable Object classes (12.2). Add one data-flow diagram each for a move, an encounter, a trade and a wager.
2. Write `PROGRESS.md`: every step in spec section 16 (M0 to M7) as a checklist with its "Done when", then the release checklist (17.3), then a "Human-only items" list.
3. Write `CLAUDE.md` in under 200 lines: commands, conventions, the standing instructions from spec section 0, and where things live. Mention `docs/DESIGN.md` in backticks instead of @-importing it, so the 85 KB spec is not loaded into every session. Make `AGENTS.md` point to `CLAUDE.md`.
4. Define interfaces and types first, then implement behind them.

### 5. Engineering standards (non-negotiable)

- TypeScript strict. No `any` outside validated boundaries. ESLint and Prettier clean.
- `packages/rules` is pure and deterministic: no `Date`, no `Math.random`, no I/O, zero runtime dependencies. It is built with `createEngine(registry, CAPS)` and never imports `content`.
- Every ability, item and trait is a module in `packages/content`, built only with the SDK (spec 13.5) and declaring `minLevel` and `slotCost`. Every limit comes from `CAPS`.
- Server authority everywhere. Clients receive only `project()` output (R-SEC-001). Build the payload-scan test as soon as projection exists.
- Durable Objects use the WebSocket Hibernation API and Alarms for time. No intervals or game loops (spec 12.2, 14.2).
- Database access goes only through Kysely and follows the portability rules (spec 13.6): SQLite locally and in tests, PostgreSQL in production.
- Write tests first for anything in `packages/rules`. Every requirement ID has at least one test whose name contains the ID.
- Small commits with conventional messages that cite requirement IDs. With no remote configured, commit each step on `main`; with a remote, use one branch and pull request per step. Log whichever applies as a DD row.
- Use the latest stable dependency versions at install time, pinned by the lockfile. Pin Phaser to 4.2.x.
- No secrets in the repo. `.dev.vars.example` documents every variable; production secrets go through Wrangler secrets.
- Never fake functionality. Anything that needs a human (accounts, keys, final art) sits behind an interface with a working local implementation and is listed under Human-only items.

### 6. Build order and gates

Follow spec section 16 exactly: M0, M1, M2, M3, Playtest Gate 1, M4, M5, M6, M7. Do not start a milestone until the previous one's "Done when" passes.

- **M0.** The root scripts in section 8 exist from day one (they may start as passing stubs). The CI workflow includes a PostgreSQL service container. Step 0.4 (Neon and Hyperdrive) is human-only: write the `DEPLOY.md` steps and a `pnpm deploy:check` script instead.
- **M1.** Beyond the start position and Kiwipete, add more published perft positions for extra coverage.
- **M2.** Build the hook system and registry first, then all six traits, all 11 items and all 14 abilities as modules, golden tests E1 to E9, and property tests. For the 100,000-game fuzz, provide `pnpm test:fuzz` (quick, runs in CI) and `pnpm test:fuzz:full` (100,000 games). Step 2.8 mentions the Arcane Chess codebase: if the human gives its path in `PROGRESS.md`, mine it for edge cases; otherwise skip it and note that.
- **M3.** `pnpm dev` runs the client locally with hot-seat and vs-NPC play in all three formats. Generate art procedurally (a coloured silhouette per piece type, glyph badges, element rings) so it meets spec 11.2 without external assets, and include Classic View. Build a dev-only **Scenario Lab** page, excluded from production builds: load any worked example E1 to E9, or a custom position plus loadouts, and step through the reaction chain event by event. Build the balance simulator CLI (`pnpm sim`).
- **Playtest Gate 1.** Do not wait for the designer. Write `docs/PLAYTEST_GATE_1.md` containing:
  - simulator matchup tables compared with the targets in spec 17.2;
  - any PLAYTEST values you tuned (never COMMITTED rules) and why;
  - a 15-minute checklist for the designer to try in the local build.

  Then continue to M4.
- **M4.** The full stack runs locally under `wrangler dev` (local Durable Objects, local D1 as SQLite), with no cloud account. Passwordless email goes through a mail-sender interface; locally the magic link prints to the console. OAuth turns on only when its keys exist. Step 4.5 (creature art) is met by original procedural pixel sprites, with a drop-in pipeline for human art; record sources in `assets/LICENSES.md`.
- **M5.** Author the Chess Academy town, one route and wild patches as Tiled-format JSON. Chat filtering follows R-SEC-011, using a curated word list behind an interface. Telemetry writes to Analytics Engine in production and to a local sink in development.
- **M6.** Billing goes through a provider interface: a fake provider for tests and local play, and Paddle Billing in sandbox mode for real payments. Include the 7-day free trial, verified webhooks and entitlement checks. Trades and wagers must pass the concurrency tests.
- **M7.** Tournaments, spectating, Storm, Stone and Frost with 18 more procedural creatures, and at least one more zone with NPC trainers.
- The "Later" items in spec section 16 are out of scope.

### 7. Quality bars before a milestone counts as done

- `pnpm check` and every test command that applies are green.
- Every TODO in the code has a matching `PROGRESS.md` entry.
- From M3 on, bundle size, memory and frame-rate budgets (spec 12.3) are measured and recorded.
- From M5 on, the cost guardrails (spec 14.2) hold, and the load test reports cost per player-hour against spec 14.1.

### 8. Test commands (define these in the root `package.json`)

| Command | What it runs |
| --- | --- |
| `pnpm check` | Typecheck, lint, unit tests, content validation |
| `pnpm test` | Unit, golden (E1 to E9) and property tests |
| `pnpm test:perft` | Perft suites |
| `pnpm test:fuzz` | Quick fuzz with replay checks (CI) |
| `pnpm test:fuzz:full` | 100,000-game fuzz with replay checks |
| `pnpm test:db` | Repositories and migrations on SQLite |
| `pnpm test:db:pg` | The same suite on PostgreSQL in a Docker container |
| `pnpm test:workers` | Durable Object integration tests |
| `pnpm test:e2e` | Playwright against the local stack |
| `pnpm test:load` | Bot clients against the local stack; prints the cost estimate |
| `pnpm sim` | Balance simulator; writes matchup tables |
| `pnpm seed` | Resets local data and creates test accounts at levels 1, 10 and 25, including one under-18 account |
| `pnpm dev` | Client plus local Worker, Durable Objects and SQLite |

### 9. Deliverables

- The complete monorepo (spec 13.1) with green CI.
- `README.md`: what the game is, quick start and repo map.
- `TESTING.md` for a human tester (section 10).
- `DEPLOY.md`: Cloudflare, Neon and Hyperdrive, migrations, secrets, Paddle and rollback.
- `docs/ARCHITECTURE.md`, `docs/PLAYTEST_GATE_1.md` and `docs/decisions/`.
- `docs/CONTENT_GUIDE.md`: how to add abilities, items and traits, with level requirements and slot costs, mirroring spec 13.5.
- Spec section 18 updated with every decision you made.

### 10. What TESTING.md must include

1. Prerequisites with exact versions (Node LTS, pnpm, optional Docker, Playwright browsers) and a one-command setup.
2. Every command from section 8, with what it proves (mapped to spec 17.1) and its expected output.
3. A manual play-test script with an expected result for each step:
   - Sign up locally (the magic link prints in the console) and complete the Chess Academy.
   - Win a wild First Blood encounter and a trainer Full Battle.
   - Run E1 to E9 in the Scenario Lab and compare each with spec 5.5.
   - Try each trait: Hot Foot burning squares, Flow through allies, Overabundance double charges, Always First ordering, Bulwark and Stillness.
   - Build loadouts at levels 1, 10 and 25 and confirm the slot and level limits.
   - Play PvP in two browsers, including a disconnect and reconnect mid-battle.
   - Confirm hidden information: the opponent's loadout never appears in the browser's network panel before it is revealed.
   - Complete a trade, a wager win, a wager draw and a challenge-zone auto-challenge.
   - Compare chat filtering with an under-18 test account present against an adults-only conversation.
   - Subscribe in fake-provider mode, then in Paddle sandbox if keys exist.
   - Run a small tournament with test accounts.
4. How to reset local data and seed test accounts (`pnpm seed`).
5. Known limitations and the human-only items.

### 11. Human-only items (prepare everything else; never fake these)

- Cloudflare account, `wrangler login` and the Workers Paid plan.
- Neon project and connection string, then a Hyperdrive configuration.
- Paddle account (sandbox, then live), product and price IDs, webhook secret and product-category approval.
- A transactional email provider for magic links.
- OAuth client IDs (optional).
- Final creature art and music (procedural art ships until then).
- Designer sign-off at Playtest Gate 1 and review of spec section 18.

### 12. Guardrails

- No Pokémon names, designs or look-alikes (R-ART-003).
- No randomness in battle resolution.
- Never weaken or skip a test to get a green build. Fix the code, or log a decision.
- Never send an opponent's unrevealed loadout to a client.
- Keep the performance and cost budgets (spec 12.3, 14.2).

### 13. Final report

When every milestone is done, or whenever you stop, post a summary:

- milestones and steps completed;
- a test results table (command, pass or fail, counts);
- measured budgets (bundle size, memory, frame rate, cost per player-hour);
- decisions logged in section 18;
- human-only items still open;
- the exact commands the human should run next.
