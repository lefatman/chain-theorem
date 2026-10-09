# Drop-in army art

Put a PNG sheet at `assets/army/<style>/<side>/<type>.png` (for example `medieval/white/knight.png`)
to replace the procedural sprite for that army style, owner and piece type in every element, or at
`assets/army/<style>/<side>/<element>/<type>.png` for one element only. The client loads the sheets
when a battle opens. Styles: `roman`, `medieval`, `arab`, `samurai`; sides: `white`, `black`;
elements: `ember`, `tide`, `grove`, `storm`, `stone`, `frost`, `neutral`.

- Six square frames in one row, 16 to 64 px each (32 px matches the procedural art, 64 px is shown
  at 1x): front idle 0, front idle 1, front faint, back idle 0, back idle 1, back faint.
- Transparent background; limited palette (the procedural sets use 16 colours in 15-bit colour).
- Readability (11.2): the piece type must be recognisable from the outline alone and must match the
  other styles' silhouettes (pawn short with a spear, knight mounted, bishop tall and slender, rook
  broad behind a tower shield, queen in a bell gown, king broad with a tall crown and a cloak). The
  owner is the armour colour (white steel, black iron); the element is the accent colour plus the
  element's emblem on the shield, chest or cape. Leave the top-left corner of each frame clear
  (columns 0..9 of rows 3..12 at 32 px) for the glyph badge.
- IP guardrails (11.3): no Pokémon or other franchise designs. Add a row to `assets/LICENSES.md` for
  every file in the same commit.
