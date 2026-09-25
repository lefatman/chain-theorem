/**
 * Chat (M5, spec 10.4, R-SEC-011): zone, party, whisper and (M6) guild tabs. The zone filters each
 * conversation for its youngest participant; filtered lines carry a marker. Sending is rate-limit
 * friendly: the button pauses briefly after each line and while the 1/s allowance refills (R-SEC-005).
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Channel } from '@chain-theorem/protocol';
import type { ChatLine, WorldController } from '../../world/controller.ts';
import { guild } from '../../state/guild.ts';

const LABEL: Record<Channel, string> = {
  zone: 'Zone',
  party: 'Party',
  guild: 'Guild',
  whisper: 'Whisper',
};

export interface WhisperTarget {
  p: string;
  name: string;
}

export interface ChatPanelProps {
  c: WorldController;
  /** Open on a channel (a "Whisper" action elsewhere sets it with a target). */
  channel: Channel;
  onChannel(ch: Channel): void;
  target: WhisperTarget | null;
  onTarget(t: WhisperTarget | null): void;
}

function Line({ l, onName }: { l: ChatLine; onName(t: WhisperTarget): void }) {
  const who = l.own ? 'You' : l.name;
  return (
    <li class={l.own ? 'own' : ''}>
      {l.own || l.ch !== 'whisper' ? (
        <strong>{who}</strong>
      ) : (
        <button
          type="button"
          class="link"
          title={`Whisper to ${l.name}`}
          onClick={() => onName({ p: l.from, name: l.name })}
        >
          {who}
        </button>
      )}
      {l.toName && <span class="muted"> to {l.toName}</span>}: {l.text}
      {l.filtered && (
        <span class="chat-filtered" title="Filtered (R-SEC-011)">
          {' '}
          <span aria-hidden="true">✱</span>
          <span class="sr-only">filtered</span>
        </span>
      )}
    </li>
  );
}

export function ChatPanel({ c, channel, onChannel, target, onTarget }: ChatPanelProps) {
  const [text, setText] = useState('');
  const [, tick] = useState(0);
  const list = useRef<HTMLOListElement>(null);
  const chat = c.chat.value;
  const unread = c.unread.value;
  const readyAt = c.chatReadyAt.value;
  const party = c.party.value;
  const lines = chat[channel];
  const tabs: Channel[] = ['zone', 'party', 'whisper'];
  // M6: the Guild tab shows while the player is in a guild (or a guild line arrived).
  const inGuild = guild.value?.guild != null;
  if (chat.guild.length > 0 || inGuild) tabs.push('guild');

  useEffect(() => {
    c.markRead(channel);
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [channel, lines.length]);

  // Re-enable the send button once the pause is over.
  useEffect(() => {
    const ms = readyAt - c.now();
    if (ms <= 0) return;
    const t = setTimeout(() => tick((n) => n + 1), ms + 10);
    return () => clearTimeout(t);
  }, [readyAt]);

  const wait = readyAt - c.now();
  const cooling = wait > 0;
  const roster = c.roster.value;
  const recent = new Map<string, string>();
  for (const l of chat.whisper) if (!l.own) recent.set(l.from, l.name);
  for (const r of roster) recent.set(r.p, r.name);
  const noParty = (channel === 'party' && !party) || (channel === 'guild' && !inGuild);
  const noTarget = channel === 'whisper' && !target;

  const send = (e: Event) => {
    e.preventDefault();
    if (c.sendChat(channel, text, channel === 'whisper' ? (target ?? undefined) : undefined))
      setText('');
  };

  return (
    <section class="world-chat" aria-label="Chat">
      <div class="tabs" role="tablist" aria-label="Chat channels">
        {tabs.map((t, i) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`chat-tab-${t}`}
            aria-selected={t === channel}
            aria-controls="chat-panel"
            tabIndex={t === channel ? 0 : -1}
            onClick={() => onChannel(t)}
            onKeyDown={(e) => {
              const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
              if (!d) return;
              e.preventDefault();
              const next = tabs[(i + d + tabs.length) % tabs.length] ?? t;
              onChannel(next);
              document.getElementById(`chat-tab-${next}`)?.focus();
            }}
          >
            {LABEL[t]}
            {unread[t] > 0 && t !== channel && (
              <span class="tab-badge">
                {' '}
                ({unread[t]}
                <span class="sr-only"> unread</span>)
              </span>
            )}
          </button>
        ))}
      </div>
      <div id="chat-panel" role="tabpanel" aria-labelledby={`chat-tab-${channel}`}>
        <ol class="chat-log" role="log" aria-live="polite" ref={list}>
          {lines.length === 0 && (
            <li class="muted">
              {channel === 'zone'
                ? 'Say hello to the players in this zone.'
                : channel === 'party'
                  ? 'Messages to your party appear here.'
                  : channel === 'guild'
                    ? 'Messages to your guild appear here.'
                    : 'Whispers go to one player only.'}
            </li>
          )}
          {lines.map((l) => (
            <Line
              key={l.id}
              l={l}
              onName={(t) => {
                onTarget(t);
                onChannel('whisper');
              }}
            />
          ))}
        </ol>
        {channel === 'whisper' && (
          <label class="inline small-text">
            To
            <select
              value={target?.p ?? ''}
              onChange={(e) => {
                const p = (e.target as HTMLSelectElement).value;
                onTarget(p ? { p, name: recent.get(p) ?? p } : null);
              }}
            >
              <option value="">Choose a player…</option>
              {target && !recent.has(target.p) && <option value={target.p}>{target.name}</option>}
              {[...recent].map(([p, name]) => (
                <option key={p} value={p}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        )}
        <form class="chat-form" onSubmit={send}>
          <input
            type="text"
            maxLength={200}
            value={text}
            placeholder={
              noParty
                ? `Join a ${channel === 'guild' ? 'guild' : 'party'} to use ${channel} chat`
                : noTarget
                  ? 'Choose who to whisper to'
                  : `Message (${LABEL[channel].toLowerCase()})`
            }
            aria-label={`Chat message to ${LABEL[channel].toLowerCase()}`}
            disabled={noParty || c.connection.value !== 'open'}
            onInput={(e) => setText((e.target as HTMLInputElement).value)}
          />
          <button
            type="submit"
            class="primary"
            disabled={cooling || noParty || noTarget || !text.trim()}
          >
            Send
          </button>
        </form>
        {wait > 600 && (
          <p class="muted small-text" role="status">
            A moment before the next message…
          </p>
        )}
      </div>
    </section>
  );
}
