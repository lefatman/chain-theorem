/**
 * Guild panel (M6 6.1, spec 10.4 R-WORLD-004): create a guild, accept or decline invitations, the
 * roster with ranks and online status, invite by name, promote, demote, hand over, remove, leave and
 * disband. Used in the world side panel and on the guild screen. The server decides who may do what;
 * the panel only offers the actions the player's rank allows.
 */
import { useEffect, useState } from 'preact/hooks';
import type { GuildMemberView, GuildRank, MyGuild } from '@chain-theorem/protocol';
import { ApiError, api } from '../net/api.ts';
import { guild, refreshGuild, setGuild } from '../state/guild.ts';

const RANK: Record<GuildRank, string> = { leader: 'Leader', officer: 'Officer', member: 'Member' };
const REFRESH_MS = 20_000;

export function guildError(e: unknown): string {
  const code = e instanceof ApiError ? e.code : 'error';
  const known: Record<string, string> = {
    bad_request:
      'A name is 3 to 24 letters, digits, spaces, apostrophes or hyphens; a tag is 2 to 5 letters or digits.',
    bad_name: 'Please choose a different name or tag.',
    name_taken: 'A guild with that name exists already.',
    tag_taken: 'That tag is taken.',
    in_guild: 'That player is in a guild already.',
    not_found: 'No player with that name.',
    ambiguous_name: 'Several players have that name: ask them for their exact name.',
    already_invited: 'That player has an invitation already.',
    full: 'The guild is full.',
    not_allowed: 'Your rank does not allow that.',
    no_invite: 'That invitation is no longer open.',
    no_guild: 'You are not in a guild.',
    offline: 'The server cannot be reached.',
  };
  return known[code] ?? `Something went wrong (${code}).`;
}

/** Actions the viewer's rank offers on a member (the server checks them again). */
function actionsFor(
  mine: GuildRank | null,
  m: GuildMemberView,
  me: string | null,
): ('promote' | 'demote' | 'lead' | 'kick')[] {
  if (m.id === me || !mine) return [];
  if (mine === 'leader') {
    if (m.rank === 'member') return ['promote', 'lead', 'kick'];
    if (m.rank === 'officer') return ['demote', 'lead', 'kick'];
    return [];
  }
  if (mine === 'officer' && m.rank === 'member') return ['kick'];
  return [];
}

export interface GuildPanelProps {
  /** The signed-in player's id (to mark "you" and hide actions on yourself). */
  me: string | null;
  /** Show headings one level lower (inside the world side panel). */
  compact?: boolean;
}

export function GuildPanel({ me, compact = false }: GuildPanelProps) {
  const g: MyGuild | null = guild.value;
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [tag, setTag] = useState('');
  const [invitee, setInvitee] = useState('');
  const [confirmDisband, setConfirmDisband] = useState(false);
  const H = compact ? 'h4' : 'h3';

  useEffect(() => {
    const load = () => void refreshGuild().catch(() => undefined);
    load();
    const t = setInterval(load, REFRESH_MS);
    window.addEventListener('focus', load);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', load);
    };
  }, []);

  const act = async (f: () => Promise<MyGuild>, done?: string) => {
    setBusy(true);
    setNote(null);
    try {
      setGuild(await f());
      if (done) setNote({ text: done, error: false });
      return true;
    } catch (e) {
      setNote({ text: guildError(e), error: true });
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!g)
    return (
      <section class="guild-panel" aria-label="Guild" aria-busy="true">
        <p class="muted">Loading your guild…</p>
      </section>
    );

  const status = note && (
    <p class={`note ${note.error ? 'warn' : 'ok'}`} role={note.error ? 'alert' : 'status'}>
      {note.text}
    </p>
  );

  const invites = g.invites.length > 0 && (
    <div class="guild-invites">
      <H>Invitations</H>
      <ul class="guild-list">
        {g.invites.map((i) => (
          <li key={i.guildId}>
            <span>
              <strong>{i.name}</strong> <span class="tag">[{i.tag}]</span>
              {i.from && <span class="muted small-text"> · from {i.from}</span>}
            </span>
            {!g.guild && (
              <span class="row start">
                <button
                  type="button"
                  class="small primary"
                  disabled={busy}
                  aria-label={`Accept the invitation to ${i.name}`}
                  onClick={() =>
                    void act(() => api.acceptGuildInvite(i.guildId), `You joined ${i.name}.`)
                  }
                >
                  Accept
                </button>
                <button
                  type="button"
                  class="small"
                  disabled={busy}
                  aria-label={`Decline the invitation to ${i.name}`}
                  onClick={() => void act(() => api.declineGuildInvite(i.guildId))}
                >
                  Decline
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );

  if (!g.guild)
    return (
      <section class="guild-panel" aria-label="Guild">
        {status}
        <p class="muted small-text">
          You are not in a guild. Found one, or accept an invitation. Guild members share a chat
          channel and a guild leaderboard.
        </p>
        {invites}
        <form
          class="guild-create"
          onSubmit={(e) => {
            e.preventDefault();
            void act(() => api.createGuild(name, tag), 'Your guild is founded.').then((ok) => {
              if (ok) {
                setName('');
                setTag('');
              }
            });
          }}
        >
          <H>Found a guild</H>
          <label>
            Guild name
            <input
              value={name}
              maxLength={24}
              required
              autocomplete="off"
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
            />
          </label>
          <label>
            Tag (2 to 5 letters or digits)
            <input
              value={tag}
              maxLength={5}
              required
              autocomplete="off"
              onInput={(e) => setTag((e.target as HTMLInputElement).value.toUpperCase())}
            />
          </label>
          <button type="submit" class="primary" disabled={busy || !name.trim() || !tag.trim()}>
            Create guild
          </button>
        </form>
      </section>
    );

  const gv = g.guild;
  const mine = g.rank;
  const staff = mine === 'leader' || mine === 'officer';
  return (
    <section class="guild-panel" aria-label="Guild">
      <H>
        {gv.name} <span class="tag">[{gv.tag}]</span>
      </H>
      <p class="muted small-text">
        {gv.size} of {gv.maxMembers} members · you are {mine ? RANK[mine].toLowerCase() : 'a guest'}
      </p>
      {status}
      <ul class="guild-list guild-roster" aria-label="Members">
        {gv.members.map((m) => {
          const acts = actionsFor(mine, m, me);
          return (
            <li key={m.id} class={m.id === me ? 'own' : ''}>
              <span class="guild-member">
                <span
                  class={`presence ${m.online ? 'on' : 'off'}`}
                  aria-hidden="true"
                  title={m.online ? 'Online' : 'Offline'}
                >
                  {m.online ? '●' : '○'}
                </span>{' '}
                <strong>{m.name}</strong>
                {m.id === me && <span class="muted"> (you)</span>}{' '}
                <span class={`tag rank-${m.rank}`}>{RANK[m.rank]}</span>{' '}
                <span class="muted small-text">
                  Lv {m.level} · {m.online ? 'online' : 'offline'}
                </span>
              </span>
              {acts.length > 0 && (
                <span class="row start guild-actions">
                  {acts.includes('promote') && (
                    <button
                      type="button"
                      class="small"
                      disabled={busy}
                      aria-label={`Promote ${m.name} to officer`}
                      onClick={() => void act(() => api.setGuildRank(m.id, 'officer'))}
                    >
                      Promote
                    </button>
                  )}
                  {acts.includes('demote') && (
                    <button
                      type="button"
                      class="small"
                      disabled={busy}
                      aria-label={`Demote ${m.name} to member`}
                      onClick={() => void act(() => api.setGuildRank(m.id, 'member'))}
                    >
                      Demote
                    </button>
                  )}
                  {acts.includes('lead') && (
                    <button
                      type="button"
                      class="small"
                      disabled={busy}
                      aria-label={`Make ${m.name} the leader`}
                      onClick={() =>
                        void act(() => api.setGuildRank(m.id, 'leader'), `${m.name} leads now.`)
                      }
                    >
                      Make leader
                    </button>
                  )}
                  {acts.includes('kick') && (
                    <button
                      type="button"
                      class="small danger"
                      disabled={busy}
                      aria-label={`Remove ${m.name} from the guild`}
                      onClick={() => void act(() => api.kickFromGuild(m.id))}
                    >
                      Remove
                    </button>
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {staff && (
        <form
          class="row start guild-invite"
          onSubmit={(e) => {
            e.preventDefault();
            const to = invitee.trim();
            void act(() => api.guildInvite(to), `Invitation sent to ${to}.`).then((ok) => {
              if (ok) setInvitee('');
            });
          }}
        >
          <label class="inline">
            Invite a player by name
            <input
              value={invitee}
              maxLength={64}
              autocomplete="off"
              onInput={(e) => setInvitee((e.target as HTMLInputElement).value)}
            />
          </label>
          <button type="submit" disabled={busy || !invitee.trim()}>
            Invite
          </button>
        </form>
      )}
      {staff && gv.invited.length > 0 && (
        <div>
          <H>Invited</H>
          <ul class="guild-list">
            {gv.invited.map((i) => (
              <li key={i.id}>
                <span>{i.name}</span>
                <button
                  type="button"
                  class="small"
                  disabled={busy}
                  aria-label={`Withdraw the invitation to ${i.name}`}
                  onClick={() => void act(() => api.revokeGuildInvite(gv.id, i.id))}
                >
                  Withdraw
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {invites}
      <div class="row start">
        <button
          type="button"
          disabled={busy}
          onClick={() => void act(() => api.leaveGuild(), `You left ${gv.name}.`)}
        >
          Leave guild
        </button>
        {mine === 'leader' &&
          (confirmDisband ? (
            <>
              <button
                type="button"
                class="danger"
                disabled={busy}
                onClick={() => {
                  setConfirmDisband(false);
                  void act(() => api.disbandGuild(gv.id), `${gv.name} was disbanded.`);
                }}
              >
                Yes, disband {gv.name}
              </button>
              <button type="button" onClick={() => setConfirmDisband(false)}>
                Keep it
              </button>
            </>
          ) : (
            <button type="button" class="danger" onClick={() => setConfirmDisband(true)}>
              Disband
            </button>
          ))}
      </div>
    </section>
  );
}
