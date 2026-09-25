# DD-45: Projection of hidden abilities (not yet named to the viewer, including under Veil): AbilityTriggered keeps the piece and type but nulls ability, category and attuned; AbilitySilenced and AbilityNegated null ability and category; EffectFizzled and ChargeSpent for an unnamed ability are not sent; ChoiceMade is sent only to the chooser

Status: binding under D-37 (designer may overrule).
Spec: R-ABIL-005, R-INFO-002, R-SEC-001, DD-28

## Decision

Projection of hidden abilities (not yet named to the viewer, including under Veil): AbilityTriggered keeps the piece and type but nulls ability, category and attuned; AbilitySilenced and AbilityNegated null ability and category; EffectFizzled and ChargeSpent for an unnamed ability are not sent; ChoiceMade is sent only to the chooser. The board effects of the activation are still sent as their own events.

## Why it is the best case

Veil promises 'your opponent sees only the effect'. Category, attunement, fizzle reasons, charge counts and declines identified the ability almost uniquely (review finding 14); a fizzle or decline has no effect to show.
