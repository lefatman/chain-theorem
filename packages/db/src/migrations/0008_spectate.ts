/**
 * 0008: spectating (M7 7.2; spec 10.4 "delayed, public-projection-only view of live battles").
 *
 * - `players.spectate`: whether others may watch this player's public battles. NULL means the
 *   default, decided at battle start from `adult_from`: on for adults, off for accounts under 18
 *   (R-SEC-011 spirit), so the default follows the player when they turn 18; 1 or 0 is the
 *   player's own choice.
 * - `battles.listed`: 1 when the battle is listed for spectators (a public kind such as ranked, a
 *   tournament or a challenge-zone battle, and both players allow it). The live list reads
 *   `(listed, started_at)` for rows without a result.
 */
import type { Migration } from './types.ts';

export const m0008Spectate: Migration = {
  id: '0008_spectate',
  up({ schema }) {
    return [
      schema.alterTable('players').addColumn('spectate', 'integer').compile(),
      schema
        .alterTable('battles')
        .addColumn('listed', 'integer', (c) => c.notNull().defaultTo(0))
        .compile(),
      schema
        .createIndex('battles_listed_idx')
        .ifNotExists()
        .on('battles')
        .columns(['listed', 'started_at'])
        .compile(),
    ];
  },
};
