# DD-83: Billing provider selection and webhooks: Paddle Billing when PADDLE_API_KEY and PADDLE_WEBHOOK_SECRET are set; otherwise the fake provider only on a local origin or with FAKE_BILLING=on; otherwise billing is off (503)

Status: binding under D-37 (designer may overrule).
Spec: 14.3, R-SEC-007, DD-07

## Decision

Billing provider selection and webhooks: Paddle Billing when PADDLE_API_KEY and PADDLE_WEBHOOK_SECRET are set; otherwise the fake provider only on a local origin or with FAKE_BILLING=on; otherwise billing is off (503). Webhooks are verified on the raw body (Paddle-Signature HMAC-SHA256, constant time, 5-minute window, several h1 values during key rotation), idempotent by (provider, event id), and ordered by the provider's occurred_at with conditional updates, so an older event is recorded but never overwrites newer state. Unknown players and ignored event types answer 200 and are recorded. The fake provider emits Paddle-shaped events signed the Paddle way with a key derived from AUTH_SECRET and runs them through the same handler.

## Why it is the best case

A production Worker that lost its keys must not hand out free subscriptions; R-SEC-007 on every engine including D1 batches; providers stop retrying; local tests exercise the production verification path.
