# Drop-in creature art

Put a PNG sheet at `assets/creatures/<element>/<type>.png` (for example `ember/knight.png`) to replace
the procedural sprite for that element and piece type. The client loads it when a battle opens.

- Six square frames in one row, 16 to 64 px each (24 px matches the procedural art, 48 px is shown at
  1x): front idle 0, front idle 1, front faint, back idle 0, back idle 1, back faint.
- Transparent background; limited palette (the procedural sets use 16 colours in 15-bit colour).
- Readability (11.2): the piece type must be recognisable from the outline alone; element changes only
  colours and small motifs. Leave the top-left corner of the frame clear for the glyph badge.
- IP guardrails (11.3): no Pokémon or other franchise designs. Add a row to `assets/LICENSES.md` for
  every file in the same commit.
