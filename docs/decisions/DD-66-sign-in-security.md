# DD-66: Security details of sign-in: magic links are single-use, 15 minutes, at most 5 per email per 15 minutes; the answer to /api/auth/start never reveals whether an account exists; sessions are 256-bit tokens stored only as SHA-256 hashes; state-changing requests must carry the app's own Origin; base64url signatures must be canonical; /api/me answers 200 with me: null when signed out

Status: binding under D-37 (designer may overrule).
Spec: R-SEC-006, R-SEC-009

## Decision

Security details of sign-in: magic links are single-use, 15 minutes, at most 5 per email per 15 minutes; the answer to /api/auth/start never reveals whether an account exists; sessions are 256-bit tokens stored only as SHA-256 hashes; state-changing requests must carry the app's own Origin; base64url signatures must be canonical; /api/me answers 200 with me: null when signed out.

## Why it is the best case

R-SEC-006 and least disclosure; a signed-out visit must not produce console errors in the client.
