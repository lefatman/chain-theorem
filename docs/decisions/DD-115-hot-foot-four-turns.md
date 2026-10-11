# DD-115: Hot Foot burns for 4 of the igniting player's opponent's turns instead of 3 (the designer's B4 plan of 2026-10-09)

Status: binding under D-37 (designer may overrule).
Spec: 6.1, 5.5 E7, R-ELEM-005, D-40, DD-25, DD-42

## Decision

Hot Foot burns for 4 of the igniting player's opponent's turns instead of 3 (the designer's B4 plan of 2026-10-09). The number is a PLAYTEST knob, CAPS.TRAITS.HOT_FOOT_TURNS in packages/content/config.ts, which traits/hot_foot.ts reads through ctx.caps at ignition; the config constant HOT_FOOT_TURNS is removed. The trait's identity (R-ELEM-005, D-40) is unchanged: only a move capture starts a burn, the square ignites when the Ember piece leaves it, non-Ember pieces cannot move to or capture on it, sliders pass over, re-ignition resets the count, and a fresh burn (DD-42) counts as before. Hot Foot is v3; spec 6.1, 5.5 E7 and the D-40 row carry the new count, and --caps restores the launch value for measurement.

## Why it is the best case

The simulator shows Ember's trait doing the least work of the six: docs/BALANCE_DD98.md section 4 finds the traits deciding First Blood with Flow and Bulwark far ahead while Hot Foot and Overabundance barely register in 17 plies, and only the numbers are open. Ember's rows have not moved since: docs/BALANCE_BASELINE.md sections 2 and 9 read 29% against its foil Tide and only 48% against Grove, the element it is meant to beat, in First Blood, and 19% against Tide in Full Battle. A fourth opponent turn makes the area denial last through most of a 23-25-ply First Blood game, where a burned square now stays closed for the rest of the fight, and strengthens the Ember-over-Grove edge without touching the silence rule or any COMMITTED identity; 4 rather than 5 or more keeps a burn expiring inside a Full Battle middlegame (median 68-69 plies) instead of freezing squares for good. The knob lets each value be measured with the same seeds (section 10 of the baseline), and a test pins that the module obeys it.
