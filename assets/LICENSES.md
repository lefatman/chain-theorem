# Asset sources and licences

Spec 11.3 (R-ART-003): every asset has a recorded source and licence. No Pokémon names, creature
designs, sprites, UI chrome, fonts, sounds, item look-alikes or type names.

| Asset                                             | Where                                                                            | Source                                                                                                                  | Licence                            |
| ------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Creature sprites (6 types × 6 elements + neutral) | Painted in code: `apps/client/src/battle/scene/sprites.ts`                       | Original procedural pixel art written for this project; names checked against a Pokémon deny-list (`creatures.test.ts`) | Project licence (same as the code) |
| Board, element icons, flame, badges, pips, bursts | Painted in code: `apps/client/src/battle/scene/art.ts`, `icons.ts`, `palette.ts` | Original, written for this project                                                                                      | Project licence                    |
| Pixel font (board coordinates, counters)          | Painted in code: `apps/client/src/battle/scene/icons.ts` (`fontGrid`)            | Original 3×5 glyphs written for this project                                                                            | Project licence                    |
| App icon                                          | `apps/client/public/icon.svg`                                                    | Original                                                                                                                | Project licence                    |
| Classic View chess glyphs                         | Not shipped: drawn with the device's own fonts (U+265A–265F)                     | System fonts on the player's device                                                                                     | Not distributed                    |
| Drop-in creature sheets                           | `assets/creatures/<element>/<type>.png`                                          | None yet. Add a row per file before committing it (artist, source file, date)                                           | Must allow commercial use          |

Music and sound effects: none yet (human-only item, see PROGRESS.md).
