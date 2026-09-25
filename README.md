# Chain Theorem

A lightweight, browser-first MMO where every battle is a full 8x8 game of chess whose pieces are
original creatures, bent by capture-triggered abilities, elemental attunement and item synergies.
Build a concealed army, then use chess positioning to exploit your build and uncover your opponent's.

- **Calculable depth:** abilities are deterministic; surprise comes from hidden loadouts, never dice.
- **Chess stays chess:** about 99% of FIDE chess is binding; abilities bend specific rules.
- **Build, then outplay:** items and ability cards matter, but play decides games.
- **Cheap to run:** Cloudflare Workers and Durable Objects with hibernation; about a cent per heavy
  player per month in variable infrastructure (spec 14).

The design spec is [`docs/DESIGN.md`](docs/DESIGN.md); the architecture and every package interface
are in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md); build status is in [`PROGRESS.md`](PROGRESS.md).

## Quick start

Requirements: Node.js 22 LTS or newer (22.12+), pnpm 10 (`corepack enable`). Docker is optional
(PostgreSQL portability tests). No cloud account is needed for local play or any automated test.

```sh
pnpm install
pnpm check          # typecheck, lint, unit tests, content validation, dependency rules
pnpm dev            # client + local Worker, Durable Objects and SQLite
```

Open the printed URL, choose **Play a local battle**, and fight a Wild, Trainer or Elite NPC (or a
friend on the same device) in First Blood, Vanguard or Full Battle.

See [`TESTING.md`](TESTING.md) for every test command and a manual play-test script, and
[`DEPLOY.md`](DEPLOY.md) for production deployment (the human-only steps).

## Repository map

| Path                | What it is                                                                                                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/rules`    | Pure, deterministic rules engine and module SDK. Zero runtime dependencies. Perft-verified move generation, the five-phase ability pipeline, projections (hidden information), loadout validation, Dossier deductions, move previews. |
| `packages/content`  | Every ability, item and element trait as a self-contained module (`abilities/`, `items/`, `traits/`), the global caps (`config.ts`) and the generated registry.                                                                       |
| `packages/ai`       | NPC search: iterative-deepening alpha-beta with an ability-aware evaluation; Wild, Trainer and Elite tiers. Sees only its own projection.                                                                                             |
| `packages/db`       | Kysely schema, migrations and repositories for PostgreSQL (production) and SQLite/D1 (local, tests).                                                                                                                                  |
| `packages/protocol` | Zod schemas for every WebSocket message and REST payload.                                                                                                                                                                             |
| `apps/client`       | Vite + Phaser 4 board and overworld, Preact overlay (loadouts, Dossier, log, previews), Scenario Lab (dev only).                                                                                                                      |
| `apps/server`       | Cloudflare Worker (auth, REST, assets) and the Durable Objects: BattleRoom, ZoneRoom, Matchmaker, GuildRoom, TradeSession, TournamentRoom.                                                                                            |
| `apps/tools`        | Content CLI (`content:new`, `content:index`, `content:validate`), fuzzer, balance simulator, load test, seed.                                                                                                                         |
| `docs`              | Spec, architecture, content guide, playtest gate report, decision records (`decisions/`).                                                                                                                                             |

## Common commands

| Command                                                                                   | Purpose                                                                         |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `pnpm test`                                                                               | Unit, golden (E1–E9), content scenario and property tests                       |
| `pnpm test:perft`                                                                         | Perft suites (start position depth 5 = 4,865,609; Kiwipete depth 4 = 4,085,603) |
| `pnpm test:fuzz` / `pnpm test:fuzz:full`                                                  | Fuzzed battles with replay and projection checks (quick / 100,000 games)        |
| `pnpm sim`                                                                                | Balance simulator; writes matchup tables to `reports/sim/`                      |
| `pnpm content:new ability <id>`                                                           | Scaffold a new ability module and its scenario test                             |
| `pnpm test:db`, `pnpm test:db:pg`, `pnpm test:workers`, `pnpm test:e2e`, `pnpm test:load` | Database, Durable Object, browser and load tests                                |
| `pnpm seed`                                                                               | Reset local data and create test accounts                                       |

## Contributing content

Adding an ability, item or trait is a content change: one module file plus its scenario test, no
engine edits. Follow [`docs/CONTENT_GUIDE.md`](docs/CONTENT_GUIDE.md).

## Art and IP

All creatures, sprites and effects are original and generated procedurally until final art arrives;
sources and licences are recorded in [`assets/LICENSES.md`](assets/LICENSES.md). There are no Pokémon
names, designs or references anywhere in the project (R-ART-003).
