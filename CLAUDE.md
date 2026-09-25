# Chain Theorem — agent guide

Browser-first MMO where every battle is chess shaped by capture-triggered abilities. The binding spec is
`docs/DESIGN.md` (85 KB — read only the sections your step cites). The build plan is
`docs/BUILD_PROMPT.md`; live status is `PROGRESS.md`; interfaces are in `docs/ARCHITECTURE.md`.

## Session protocol

1. Read this file, `PROGRESS.md` and `git log --oneline -20`.
2. Resume at the first unchecked step in `PROGRESS.md`; reread only the spec sections it cites.
3. After each step: `pnpm check` plus that step's tests, commit, then update `PROGRESS.md` (status,
   evidence with commands and pass counts, next step, blockers).
4. Never commit a failing build. If context runs low, finish or shelve the step, commit, and put a
   handoff note at the top of `PROGRESS.md`.

## Standing instructions (spec section 0)

- Precedence: INVARIANT > COMMITTED > ability/item text > PROVISIONAL. PLAYTEST values live in config
  (`packages/content/config.ts`) and content data, never in engine code.
- The rules engine is pure and deterministic: no clock reads, no unseeded randomness, no I/O.
- Abilities, items and traits are content modules; adding one never edits the resolver unless it needs
  a new effect primitive (log it).
- The server never sends an opponent's unrevealed loadout to a client (R-SEC-001). Clients only get
  `project()` / `projectEvents()` output.
- Every requirement ID (`R-<AREA>-<NNN>`, INV-xx) has at least one test whose name contains the ID.
  Cite IDs in commit messages and code comments that implement them.
- Ambiguity: choose the best-case option that fits the pillars (spec 1), add a DD row to spec section 18
  and a record in `docs/decisions/`, keep building. Never stall; never change a COMMITTED rule.
- No randomness in battle resolution. No Pokémon names, designs or look-alikes (R-ART-003).
- Never weaken or skip a test to get green. Never fake functionality: human-only services sit behind an
  interface with a working local implementation.

## Commands

| Command                                   | Runs                                                                    |
| ----------------------------------------- | ----------------------------------------------------------------------- |
| `pnpm check`                              | typecheck, lint, unit tests, content validation, dependency rules       |
| `pnpm test`                               | unit, golden (E1–E9), content scenario and property tests               |
| `pnpm test:perft`                         | perft suites                                                            |
| `pnpm test:fuzz` / `test:fuzz:full`       | quick fuzz (CI) / 100,000-game fuzz, with replay checks                 |
| `pnpm test:db` / `test:db:pg`             | repositories and migrations on SQLite / PostgreSQL                      |
| `pnpm test:workers`                       | Durable Object integration tests                                        |
| `pnpm test:e2e`                           | Playwright against the local stack                                      |
| `pnpm test:load`                          | bot clients; prints cost per player-hour                                |
| `pnpm sim`                                | balance simulator; writes matchup tables                                |
| `pnpm seed`                               | reset local data, create test accounts (levels 1, 10, 25, one under 18) |
| `pnpm dev`                                | client + local Worker, Durable Objects and SQLite                       |
| `pnpm content:new ability <id>`           | scaffold a module + test (`item`, `trait` too)                          |
| `pnpm content:index` / `content:validate` | regenerate registry / validate all modules                              |
| `pnpm format`                             | Prettier                                                                |

## Where things live

- `packages/rules/src` — engine: `types.ts`, `board.ts`/`fen.ts`, `movegen.ts`, `zobrist.ts`,
  `pipeline/` (five phases, effects, triggers), `loadout.ts`, `project.ts`, `deduce.ts`,
  `preview.ts`, `engine.ts` (`createEngine`), `sdk/` (`defineAbility`, `defineItem`, `defineTrait`,
  `fx`, `target`, `square`, hook types).
- `packages/content` — `abilities/`, `items/`, `traits/` (one module + test each), `config.ts` (CAPS,
  formats), `registry.generated.ts`, `src/testing.ts` (`scenario()`), NPC and quest data.
- `packages/ai` — NPC search. `packages/db` — Kysely schema, migrations, repositories.
  `packages/protocol` — Zod message schemas.
- `apps/client` — Vite + Phaser 4.2 + Preact. `apps/server` — Worker + Durable Objects.
  `apps/tools` — content CLI, simulator, fuzzer, load test, seed.
- `docs/decisions/` — one record per delegated decision (DD-xx), mirrored in spec section 18.

## Conventions

- TypeScript strict; no `any` outside validated boundaries (Zod). ESLint + Prettier clean.
- Workspace packages export `.ts` sources; no library build step.
- Tests: Vitest; names include requirement IDs, e.g. `it('R-RULES-004 royal immunity ...')`.
  Rules code is test-first. Perft files end in `.perft.test.ts`; DB tests live in `packages/db`.
- Commits: conventional (`feat(rules): ... (R-ABIL-003)`), small, one step at a time. This build runs on
  the single session branch recorded in `PROGRESS.md` (DD-16).
- Database access only through Kysely repositories in `packages/db` (portable SQL, UUIDv7 ids, epoch ms,
  JSON as TEXT/JSONB validated with Zod, atomic statement lists, no `SELECT … FOR UPDATE`).
- Durable Objects: WebSocket Hibernation API and Alarms only; no intervals, loops or outbound sockets.
- Secrets only via `wrangler secret`; `.dev.vars.example` documents every variable.
