# DD-123: Cornered (plan item C6; designer brief 2026-10-09) ships as Captured, neutral, eligible on every type, level 4, one slot, one charge: when captured on a rim square (the a- or h-file, the first or eighth rank) it effect-captures the captor

Status: binding under D-37 (designer may overrule).
Spec: 5.2, 5.4, 5.6, 5.7, R-ABIL-002, R-ABIL-005, plan item C6

## Decision

Cornered (plan item C6; designer brief 2026-10-09) ships as Captured, neutral, eligible on every type, level 4, one slot, one charge: when captured on a rim square (the a- or h-file, the first or eighth rank) it effect-captures the captor. It carries no venom tag, so a Stalwart captor is spared, and Royal Immunity, Pierce, Overwhelm, Antidote, Buttress and Bulwark counter it as they counter Poisoned Meat. The rim test is a new trigger condition primitive, ZONE ({ zone: { of: 'victim' | 'captor'; is: 'rim' } }, 5.6): the named piece's square lies in the zone, a captured piece using the square it was captured on (5.4) and the captor the square it stands on when the trigger is evaluated; a failed condition means no trigger, no reveal and no charge. Spec 5.2, 5.7 and 5.8 rows added; module tests cover every edge, the centre, Royal Immunity, Pierce, Stalwart, INV-03 and the single charge through a Rebirth revival.

## Why it is the best case

The brief asks for a positional Poisoned Meat that does nothing in the centre and pairs with Snowdrift, Snowbound and Frost Heave, which push enemies to the edge. Only a trigger condition keeps the card hidden and its charge unspent when the capture is not on the rim (an fx.when would reveal the activation and resolve the trigger), and the Condition type had no square test, so ZONE is the smallest primitive that expresses the rule and stays open to other zones. Leaving the venom tag off keeps Stalwart among its counters, as the brief lists, and follows the balance plan's principle that every strong card has two counters in different categories.
