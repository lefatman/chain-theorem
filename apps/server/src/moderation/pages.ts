/**
 * The admin console pages (M6 6.4, like the cost dashboard DD-81): server-rendered HTML with a
 * strict CSP and no script. Forms post to `/admin/*` (the app's origin check applies, and the
 * SameSite session cookie is not sent cross-site), then redirect back with a fixed notice.
 */
import type { PlayerFacts, PlayerSummary, ReportView } from './admin.ts';

/** No scripts, no external anything; forms may only post back here. */
export const ADMIN_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

export const esc = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

const when = (ms: number | null): string =>
  ms === null ? '—' : `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

const REASONS: Record<string, string> = {
  harassment: 'Harassment',
  hate: 'Hate',
  cheating: 'Cheating',
  spam: 'Spam',
  inappropriate_name: 'Inappropriate name',
  other: 'Other',
};

/** Notices after an action (a fixed list: nothing from the query string is echoed). */
export const NOTICES: Record<string, string> = {
  reviewed: 'Report marked reviewed.',
  dismissed: 'Report dismissed.',
  suspended: 'Player suspended; their sessions and live connections were closed.',
  unsuspended: 'Suspension lifted.',
  chat_banned: 'Chat ban set.',
  chat_unbanned: 'Chat ban lifted.',
};

export function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': ADMIN_CSP,
      'x-content-type-options': 'nosniff',
      // Not no-referrer: that makes browsers send `Origin: null` on the forms' POSTs (the origin check).
      'referrer-policy': 'same-origin',
    },
  });
}

function page(title: string, body: string, notice?: string): string {
  const note = notice && NOTICES[notice];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>
:root{color-scheme:light dark;--bg:#fff;--fg:#1b1b1b;--mute:#666;--line:#ccc;--bad:#b3261e;--ok:#1b6e2e;--field:#f4f4f4}
@media (prefers-color-scheme:dark){:root{--bg:#141414;--fg:#eee;--mute:#aaa;--line:#444;--bad:#ff8a80;--ok:#8fd19e;--field:#222}}
*{box-sizing:border-box}body{font:15px/1.45 system-ui,sans-serif;background:var(--bg);color:var(--fg);margin:0 auto;padding:16px;max-width:1100px}
nav{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:12px}a{color:inherit}
h1{font-size:1.4em;margin:.2em 0 .6em}h2{font-size:1.15em;margin:1.4em 0 .5em}
.card{border:1px solid var(--line);border-radius:8px;padding:12px;margin:10px 0}
.muted{color:var(--mute)}.bad{color:var(--bad);font-weight:600}.ok{color:var(--ok)}
.notice{border:2px solid var(--ok);padding:8px 12px;border-radius:6px}
label{display:block;margin:.4em 0 .2em}input,textarea,select,button{font:inherit;color:inherit}
input[type=text],input[type=search],input[type=number],textarea{width:100%;max-width:32em;padding:6px;background:var(--field);border:1px solid var(--line);border-radius:4px}
textarea{min-height:3.2em}button{padding:6px 12px;margin:6px 6px 0 0;border:1px solid var(--line);border-radius:4px;background:var(--field);cursor:pointer}
button.danger{border-color:var(--bad);color:var(--bad)}.row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 12px;margin:0}dt{color:var(--mute)}dd{margin:0;overflow-wrap:anywhere}
table{border-collapse:collapse;width:100%;display:block;overflow-x:auto}td,th{border-bottom:1px solid var(--line);padding:4px 8px;text-align:left;vertical-align:top}
code,pre{font-size:.9em;overflow-wrap:anywhere;white-space:pre-wrap}
</style></head><body><nav aria-label="Admin"><a href="/admin">Reports queue</a><a href="/admin/players">Player lookup</a><a href="/admin/cost">Cost dashboard</a><a href="/">Back to the game</a></nav><main>
${note ? `<p class="notice" role="status">${esc(note)}</p>` : ''}${body}</main></body></html>`;
}

function contextHtml(r: ReportView): string {
  const c = r.context;
  if (!c) return '';
  const parts: string[] = [];
  if (c.chat) parts.push(`${esc(c.chat.ch)} chat: <q>${esc(c.chat.text)}</q>`);
  if (c.battleId) parts.push(`battle <code>${esc(c.battleId)}</code>`);
  if (c.tradeId) parts.push(`trade <code>${esc(c.tradeId)}</code>`);
  return parts.length > 0 ? `<p>Context: ${parts.join('; ')}</p>` : '';
}

function reportCard(r: ReportView, actions: boolean): string {
  const who = (n: { id: string; name: string } | null) =>
    n
      ? `<a href="/admin/players/${encodeURIComponent(n.id)}">${esc(n.name)}</a>`
      : '<span class="muted">deleted account</span>';
  const id = esc(r.id);
  const form = actions
    ? `<form method="post" action="/admin/reports/${encodeURIComponent(r.id)}"><label for="note-${id}">Moderator note (optional)</label><textarea id="note-${id}" name="note" maxlength="500"></textarea><div class="row"><button type="submit" name="action" value="review">Mark reviewed</button><button type="submit" name="action" value="dismiss">Dismiss</button></div></form>`
    : r.status === 'open'
      ? ''
      : `<p class="muted">${esc(r.status)} ${esc(when(r.resolvedAt))}${r.resolvedBy ? ` by ${esc(r.resolvedBy.name)}` : ''}${r.resolutionNote ? `: ${esc(r.resolutionNote)}` : ''}</p>`;
  return `<article class="card" aria-label="Report ${id}"><p><strong>${esc(REASONS[r.reason] ?? r.reason)}</strong> · ${esc(when(r.createdAt))}</p><p>Reported: ${who(r.target)} · by ${who(r.reporter)}</p>${r.note ? `<p>Note: ${esc(r.note)}</p>` : ''}${contextHtml(r)}${form}</article>`;
}

export function consolePage(q: { reports: ReportView[]; open: number }, notice?: string): string {
  const list =
    q.reports.length === 0
      ? '<p class="muted">No open reports.</p>'
      : q.reports.map((r) => reportCard(r, true)).join('');
  return page(
    'Moderation console',
    `<h1>Moderation console</h1><form method="get" action="/admin/players" role="search" class="card"><label for="q">Find a player by display name or email</label><div class="row"><input id="q" type="search" name="q" maxlength="254" required><button type="submit">Search</button></div></form><h2>Open reports (${q.open}), oldest first</h2>${list}`,
    notice,
  );
}

export function searchPage(q: string, players: PlayerSummary[]): string {
  const rows = players
    .map(
      (p) =>
        `<tr><td><a href="/admin/players/${encodeURIComponent(p.id)}">${esc(p.name)}</a></td><td>${esc(p.email)}</td><td>${p.level}</td><td>${esc(when(p.createdAt))}</td><td>${p.suspended ? '<span class="bad">suspended</span>' : ''}${p.chatBanned ? ' <span class="bad">chat ban</span>' : ''}</td></tr>`,
    )
    .join('');
  const result = q
    ? players.length === 0
      ? `<p>No player matches <q>${esc(q)}</q>.</p>`
      : `<table><thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Level</th><th scope="col">Created</th><th scope="col">State</th></tr></thead><tbody>${rows}</tbody></table>`
    : '';
  return page(
    'Player lookup',
    `<h1>Player lookup</h1><form method="get" action="/admin/players" role="search" class="card"><label for="q">Display name (or its start), exact email, or id</label><div class="row"><input id="q" type="search" name="q" maxlength="254" value="${esc(q)}" required><button type="submit">Search</button></div></form>${result}`,
  );
}

export function playerPage(p: PlayerFacts, notice?: string): string {
  const base = `/admin/players/${encodeURIComponent(p.id)}`;
  const state = p.suspension
    ? `<span class="bad">Suspended ${p.suspension.until === null ? 'indefinitely' : `until ${esc(when(p.suspension.until))}`}</span> (since ${esc(when(p.suspension.at))})`
    : '<span class="ok">Active</span>';
  const chat = p.chatBanUntil
    ? `<span class="bad">Banned until ${esc(when(p.chatBanUntil))}</span>`
    : 'Allowed';
  const suspendForm = p.suspension
    ? `<form method="post" action="${base}/unsuspend"><button type="submit">Lift the suspension</button></form>`
    : `<form method="post" action="${base}/suspend"><h3>Suspend</h3><label for="s-hours">Hours</label><input id="s-hours" type="number" name="hours" min="0.25" step="0.25" value="24"><label><input type="checkbox" name="indefinite" value="1"> Indefinitely (ignores hours)</label><label for="s-reason">Reason (audit log)</label><input id="s-reason" type="text" name="reason" maxlength="500" required><div class="row"><button type="submit" class="danger">Suspend</button></div></form>`;
  const chatForm = p.chatBanUntil
    ? `<form method="post" action="${base}/chat-unban"><button type="submit">Lift the chat ban</button></form>`
    : `<form method="post" action="${base}/chat-ban"><h3>Chat ban (server-wide)</h3><label for="c-hours">Hours</label><input id="c-hours" type="number" name="hours" min="0.25" step="0.25" value="24" required><label for="c-reason">Reason (audit log)</label><input id="c-reason" type="text" name="reason" maxlength="500" required><div class="row"><button type="submit" class="danger">Ban from chat</button></div></form>`;
  const reports =
    p.reports.recent.length === 0
      ? '<p class="muted">No reports.</p>'
      : p.reports.recent.map((r) => reportCard(r, false)).join('');
  const audit =
    p.audit.length === 0
      ? '<p class="muted">No entries.</p>'
      : `<table><thead><tr><th scope="col">When</th><th scope="col">Kind</th><th scope="col">Details</th></tr></thead><tbody>${p.audit
          .map(
            (a) =>
              `<tr><td>${esc(when(a.at))}</td><td>${esc(a.kind)}</td><td><code>${esc(JSON.stringify(a.payload))}</code></td></tr>`,
          )
          .join('')}</tbody></table>`;
  return page(
    `Player ${p.name}`,
    `<h1>${esc(p.name)}</h1><section class="card" aria-label="Account facts"><dl><dt>Id</dt><dd><code>${esc(p.id)}</code></dd><dt>Email</dt><dd>${esc(p.email)}</dd><dt>Level</dt><dd>${p.level}</dd><dt>Created</dt><dd>${esc(when(p.createdAt))}</dd><dt>Access</dt><dd>${esc(p.access)}</dd><dt>Online</dt><dd>${p.online ? esc(p.online) : 'no'}</dd><dt>Account</dt><dd>${state}</dd><dt>Chat</dt><dd>${chat}</dd><dt>Reports</dt><dd>${p.reports.open} open of ${p.reports.total}</dd></dl></section><section class="card" aria-label="Actions"><h2>Actions</h2>${suspendForm}${chatForm}</section><h2>Reports about this player</h2>${reports}<h2>Recent audit entries</h2>${audit}`,
    notice,
  );
}

export function errorPage(status: number, code: string): Response {
  const text: Record<string, string> = {
    signed_out: 'Sign in with an admin account first, then reload this page.',
    forbidden: 'This account is not an admin.',
    not_found: 'Not found.',
    not_open: 'That report is already closed.',
    bad_target: 'You cannot do that to your own account.',
    bad_request: 'Please check the form.',
  };
  return htmlResponse(page('Admin', `<h1>Admin</h1><p>${esc(text[code] ?? code)}</p>`), status);
}
